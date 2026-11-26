import { apiFetch } from "@/lib/api-client";
import type { LeaveQueueItem } from "@/lib/leave-api";
import { clockRange, dayLabel } from "@/lib/schedule-leave";
import { ApiError } from "@/types";
import type {
  ScheduleGap,
  ScheduleTimeOff,
  ScheduleTimeOffInput,
  ScheduleViolation,
} from "@/types";

/*
 * G382 请假框用的接口（总览页 Settings › HR › Schedule；Annie 2026-11-25 答 Q1–Q12、N1–N3，3d 派 6e「今天必做」）。
 * 契约：后端 task/g382-hr-schedule @ bb5c06de docs/g382-hr-schedule/interface.md（窗口 7d）。后端还没写，
 * 页面先用 mock（checks/headless/g382-leave-mock.js）；字段以契约为准，后端改了先发前端主窗口。
 */

/** 请假类别一行（interface.md 1 节）。上线三行：pto PTO、sick Sick、personal Leave（Q8 备注）。 */
export interface LeaveCategory {
  key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

/** 类别没读到（旧后端 / 读失败）时的兜底，和上线种子一样。 */
export const FALLBACK_LEAVE_CATEGORIES: LeaveCategory[] = [
  { key: "pto", label: "PTO", sort_order: 1, is_active: true },
  { key: "sick", label: "Sick", sort_order: 2, is_active: true },
  { key: "personal", label: "Leave", sort_order: 3, is_active: true },
];

export function leaveCategoryLabel(
  categories: LeaveCategory[],
  key: string,
): string {
  return (
    categories.find((c) => c.key === key)?.label ??
    FALLBACK_LEAVE_CATEGORIES.find((c) => c.key === key)?.label ??
    key
  );
}

const CAT = "/api/schedule/leave-categories";

export async function fetchLeaveCategories(
  opts: { activeOnly?: boolean; signal?: AbortSignal } = {},
): Promise<LeaveCategory[]> {
  const res = await apiFetch<{ categories?: LeaveCategory[] }>(
    `${CAT}${opts.activeOnly ? "?active=1" : ""}`,
    { cache: "no-store", signal: opts.signal },
  );
  return [...(res.categories ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
}

/** settings.schedule（Q7 B）；key 后端从名字生成。 */
export async function createLeaveCategory(
  label: string,
): Promise<LeaveCategory> {
  const res = await apiFetch<{ category: LeaveCategory }>(CAT, {
    method: "POST",
    body: { label },
  });
  return res.category;
}

export async function updateLeaveCategory(
  key: string,
  input: Partial<Pick<LeaveCategory, "label" | "sort_order" | "is_active">>,
): Promise<LeaveCategory> {
  const res = await apiFetch<{ category: LeaveCategory }>(
    `${CAT}/${encodeURIComponent(key)}`,
    { method: "PUT", body: input },
  );
  return res.category;
}

/** 主管直接录假（现有 PUT /api/schedule/time-off，G382 多收 start_time / end_time，有的话只能一天）。 */
export function addTimeOff(
  input: ScheduleTimeOffInput,
): Promise<{ time_off: ScheduleTimeOff[] }> {
  return apiFetch<{ time_off: ScheduleTimeOff[] }>("/api/schedule/time-off", {
    method: "PUT",
    body: input,
  });
}

/** 改一条已有的假（interface.md 2.4；日期不改）。改成整天 = 两个时间都 null。 */
export async function updateTimeOff(
  id: number,
  input: {
    kind?: string;
    start_time?: string | null;
    end_time?: string | null;
    note?: string | null;
  },
): Promise<ScheduleTimeOff> {
  const res = await apiFetch<{ time_off: ScheduleTimeOff }>(
    `/api/schedule/time-off/${id}`,
    { method: "PUT", body: input },
  );
  return res.time_off;
}

export function deleteTimeOff(id: number): Promise<unknown> {
  return apiFetch<unknown>(`/api/schedule/time-off/${id}`, {
    method: "DELETE",
  });
}

/** 批复人看到的一条（GET /api/schedule/leave-requests、range.leave_requests）；G382 多三个字段 + would_gap。 */
export type OverviewLeaveRequest = Omit<LeaveQueueItem, "kind" | "shifts"> & {
  kind: string;
  kind_label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  /** 按小时的：批了会空出来的那段（已发布 / 草稿都算）。 */
  would_gap?: ScheduleGap[] | null;
  shifts?:
    | (NonNullable<LeaveQueueItem["shifts"]>[number] & {
        slot_id?: number;
      })[]
    | null;
};

export interface ApproveBody {
  /** Q11 A：批之前改日期 / 时段 / 类别。没改就不带。 */
  adjust?: {
    date_from: string;
    date_to: string;
    kind: string;
    start_time: string | null;
    end_time: string | null;
  };
  /** Q1 A：按天的假，那几天的班怎么处理。 */
  shifts?: (
    | { slot_id: number; action: "give"; employee_id: number }
    | { slot_id: number; action: "delete" }
  )[];
  /** Q2 A：按小时的假，谁顶上（后端加一个同时段的班，类型沿用、备注 Cover for …）。 */
  cover?: { employee_id: number };
  /** 写进员工的批准通知（≤120，同 reject；7d f77fbb57）。 */
  note?: string;
}

/**
 * range/changes 里录 / 删假的 op（7d f77fbb57）：跟班的 op 同一事务、按顺序执行，全部执行完再查 gap / 规则。
 * 总览的 ops 类型 = ScheduleWeekOp | TimeOffOp。
 */
export type TimeOffOp =
  | {
      op: "time_off_set";
      employee_id: number;
      date: string;
      kind: string;
      start_time: string | null;
      end_time: string | null;
      note: string | null;
    }
  | { op: "time_off_delete"; id: number };

/** 点了就存（同现在 leave-view 的批复），一个事务；任一不成整条不批。 */
export function approveLeaveWithChanges(
  id: number,
  body: ApproveBody,
): Promise<unknown> {
  return apiFetch<unknown>(`/api/schedule/leave-requests/${id}/approve`, {
    method: "POST",
    body,
  });
}

export interface LeaveSaveError {
  detail: string;
  code?: string;
  gaps?: ScheduleGap[];
  violations?: ScheduleViolation[];
}

/** 读 400 / 409 回包（FastAPI 可能包一层 detail）。读不出来用 fallback 文字。 */
export function leaveErrorOf(error: unknown, fallback: string): LeaveSaveError {
  if (error instanceof ApiError) {
    const body = error.body as Record<string, unknown> | null;
    const inner =
      body && typeof body === "object" && typeof body.detail === "object"
        ? (body.detail as Record<string, unknown>)
        : body;
    if (inner && typeof inner.detail === "string") {
      return inner as unknown as LeaveSaveError;
    }
    // error.message 是中文的「API 请求失败」，不给 staff 看。
  }
  return { detail: fallback };
}

/**
 * 红框里显示的文字：后端原话；409 rule_violation / coverage_gap 时下面逐行列出后端给的违规原句 / 空档
 * （e2 对后端 c336d008：detail 只有一句「This change breaks a schedule rule…」，看不出是谁、哪条）。
 */
export function leaveErrorText(error: unknown, fallback: string): string {
  const e = leaveErrorOf(error, fallback);
  const lines = [e.detail];
  if (e.code === "rule_violation" && Array.isArray(e.violations))
    for (const v of e.violations) if (v?.message) lines.push(`• ${v.message}`);
  if (e.code === "coverage_gap" && Array.isArray(e.gaps))
    for (const g of e.gaps)
      if (g?.date && g.start_time && g.end_time)
        lines.push(
          `• ${dayLabel(g.date)} ${clockRange(g.start_time, g.end_time)}`,
        );
  return lines.join("\n");
}
