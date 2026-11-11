import { apiFetch } from "@/lib/api-client";

/*
 * G282 员工申请休假 + 按管理层级批复（Annie 2026-11-11「同意全部推荐。动手」，preview v3 https://claude.ai/artifact/5PMGSaW5Rxz6AvcCkmAArG）。
 * 规则（Q1–Q10 全 A）：
 *   - 员工只能给自己申请；没批的可以自己撤，批了的找批复人在 Schedule 里删（Q3 A）；不限提前几天（Q4 A）；整条批或驳回（Q6 A）。
 *   - 发给谁：Manager → 没设就发所在 team 的 Team lead（几个都发，谁先批算谁）→ 都没有发 Super Admin；SA 永远能批（Q8 A / Q10 A）。
 *     只有直属 Manager 能批，上级的上级看不到（Q9 A）。
 *   - 那天已排班：照样能批，黄框提示，排班不自动改（Q7 A）。批准后写进 schedule_time_off（同 Schedule 里手动加的 Leave）。
 * 后端 21 做（两张新表 + 迁移），形状照 21 2026-11-11 发的定稿草案。
 */

export type LeaveKind = "pto" | "sick" | "personal";
export type LeaveStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const LEAVE_KINDS: { value: LeaveKind; label: string }[] = [
  { value: "pto", label: "PTO" },
  { value: "sick", label: "Sick" },
  { value: "personal", label: "Personal" },
];

export function leaveKindLabel(kind: string): string {
  return LEAVE_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** 一条申请最多几天（后端同样挡）。 */
export const LEAVE_MAX_DAYS = 31;
/** 备注最多几个字（后端同样挡）。 */
export const LEAVE_NOTE_MAX = 120;

export interface LeaveRequest {
  id: number;
  employee_id?: number;
  employee_name?: string;
  date_from: string;
  date_to: string;
  kind: LeaveKind;
  note: string | null;
  status: LeaveStatus;
  /** 一共几天（含头尾）；没带前端自己算。 */
  days?: number;
  created_at: string;
  decided_by?: number | null;
  decided_by_name?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
}

/** 那几天里已经排了的班（Q7 A：批时黄框提示）。 */
export interface LeaveShift {
  date: string;
  shift_type?: string | null;
  /** 班名，例如「Day」；后端没给就前端只写日期。 */
  label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

/** 批复人看到的一条：多带是谁、为什么发给我、那几天的班。 */
export interface LeaveQueueItem extends LeaveRequest {
  employee_name: string;
  user_id?: number | null;
  /** 这条发给了谁（能批的人）。 */
  approver_names?: string[] | null;
  /** 我能不能批（false = 只能看）。 */
  can_decide?: boolean;
  /** 为什么到我这里：manager = 我是他的 Manager；team_lead = 我是他所在 team 的 lead；super_admin = 兜底。 */
  route?: "manager" | "team_lead" | "super_admin" | null;
  /** route = team_lead 时是哪几个 team。 */
  team_names?: string[] | null;
  shifts?: LeaveShift[] | null;
}

export interface NewLeaveRequest {
  date_from: string;
  date_to: string;
  kind: LeaveKind;
  note: string | null;
}

const BASE = "/api/schedule/leave-requests";

export interface MyLeave {
  /** 这个账号在排班名单上的哪一行；null = 不在名单上（不能申请，只显示一句提示）。 */
  employee: { id: number; name: string } | null;
  requests: LeaveRequest[];
}

/** 我自己的申请（新的在前）。 */
export async function fetchMyLeaveRequests(
  signal?: AbortSignal,
): Promise<MyLeave> {
  const res = await apiFetch<Partial<MyLeave>>(`${BASE}/mine`, {
    cache: "no-store",
    signal,
  });
  return {
    employee: res.employee === undefined ? null : res.employee,
    requests: res.requests ?? [],
  };
}

export function createLeaveRequest(
  input: NewLeaveRequest,
): Promise<{ request: LeaveRequest }> {
  return apiFetch<{ request: LeaveRequest }>(BASE, {
    method: "POST",
    body: input,
  });
}

/** 只有自己的、pending 的能撤（Q3 A）；不是 pending ⇒ 409 code already_decided。 */
export function withdrawLeaveRequest(id: number): Promise<unknown> {
  return apiFetch<unknown>(`${BASE}/${id}/withdraw`, { method: "POST" });
}

export interface LeaveQueue {
  /** false = 没人报给我、也不是 Super Admin ⇒ 批复那两块整块不显示。 */
  is_approver: boolean;
  pending_count: number;
  requests: LeaveQueueItem[];
}

/**
 * 我能批的：status=pending 是 Waiting for approval，status=decided 是 Handled（最近 30 天批准 / 驳回 / 撤回的）。
 * 不是批复人时 is_approver=false、空列表（不是 403）。
 */
export async function fetchLeaveQueue(
  status: "pending" | "decided",
  signal?: AbortSignal,
): Promise<LeaveQueue> {
  const res = await apiFetch<Partial<LeaveQueue>>(`${BASE}?status=${status}`, {
    cache: "no-store",
    signal,
  });
  const requests = res.requests ?? [];
  return {
    is_approver: res.is_approver ?? requests.length > 0,
    pending_count:
      res.pending_count ?? (status === "pending" ? requests.length : 0),
    requests,
  };
}

export function approveLeaveRequest(id: number): Promise<unknown> {
  return apiFetch<unknown>(`${BASE}/${id}/approve`, {
    method: "POST",
    body: {},
  });
}

/** 理由可空（≤120）。 */
export function rejectLeaveRequest(
  id: number,
  note: string | null,
): Promise<unknown> {
  return apiFetch<unknown>(`${BASE}/${id}/reject`, {
    method: "POST",
    body: note ? { note } : {},
  });
}

/* ───── Manager / Team lead（Team 页；admin 只读，Super Admin 改） ───── */

export interface LeaveRoutingPerson {
  user_id: number;
  name: string;
  role: string;
  manager_user_id: number | null;
  team_ids: number[];
}

export interface LeaveRouting {
  people: LeaveRoutingPerson[];
  teams: { id: number; name: string; lead_user_id: number | null }[];
  /** 能当 Manager / lead 的人：在用的 staff / supervisor / admin / superadmin（后端已筛掉 driver / guide / partner）。 */
  candidates: { user_id: number; name: string; role: string }[];
}

export function fetchLeaveRouting(signal?: AbortSignal): Promise<LeaveRouting> {
  return apiFetch<LeaveRouting>("/api/schedule/leave-routing", {
    cache: "no-store",
    signal,
  });
}

export function saveLeaveManager(
  userId: number,
  managerUserId: number | null,
): Promise<unknown> {
  return apiFetch<unknown>(`/api/schedule/leave-routing/managers/${userId}`, {
    method: "PUT",
    body: { manager_user_id: managerUserId },
  });
}

export function saveTeamLead(
  teamId: number,
  leadUserId: number | null,
): Promise<unknown> {
  return apiFetch<unknown>(`/api/schedule/leave-routing/team-leads/${teamId}`, {
    method: "PUT",
    body: { lead_user_id: leadUserId },
  });
}

/** 两个日期（YYYY-MM-DD）之间一共几天，含头尾；格式不对 / 倒过来返回 0。 */
export function leaveDayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** 「Mon Nov 24」或「Mon Nov 24 – Wed Nov 26」。 */
export function leaveRangeLabel(from: string, to: string): string {
  const fmt = (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

/** 「Nov 11 9:41 AM」（洛杉矶时间）。 */
export function leaveTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}
