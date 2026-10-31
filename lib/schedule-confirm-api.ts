import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/types";

/**
 * 周三确认下周排班。第一版：Annie 2026-10-19「现在动手」（后端 `npe-confirmation-service` 4368567）。
 *
 * G138 改版（Annie 2026-10-30「动手」；preview https://claude.ai/artifact/X2bdxVr42yXA6CS8FEEiCc ；
 * 接口照 4e 2026-10-30 晚的「G138 后端最终接口」）：
 *  - 员工看整周排班表（所有人的班），只能拖自己的卡片：拖到别人有班的格子 = 换班（swap，先问对方，
 *    对方 Accept 后交排班的人批）；拖到自己 off 的那天 = 改天（move）；在自己 off 的那天打开 = 加班（add，只能选已有班次）。
 *  - 期限 = 那一周之前的周四 12:00 PM（洛杉矶）。过了只能看，没回的算 Looks good；期限前发出的请求照常走完。
 *  - 通知只发相关员工；排班的人和 Super Admin 不收通知，只在周表 / Responses 卡 / History 里看。
 *
 * 员工这一边有两种进法，响应形状一样：
 *  - 登录后：`/api/schedule/confirmation?week=YYYY-MM-DD`；
 *  - 邮件里的链接（不用登录）：`/api/schedule/confirmation/link/{token}?week=YYYY-MM-DD`（token 模式同样要带 `week`）。
 * 排班的人这一边：`GET /api/schedule/weeks/{week}/confirmations`，Approve / Decline 一条请求。
 */

export type ConfirmAnswer = "accepted" | "wants_changes";

export type RequestStatus =
  /** 等排班的人处理。 */
  | "pending"
  | "approved"
  | "declined"
  /** 换班：等原来那个人回复。 */
  | "awaiting_peer"
  /** 换班：原来那个人不同意，结束。 */
  | "peer_declined"
  /** 第一次 Publish 时还没处理完，关掉了。 */
  | "closed";

export type RequestKind = "swap" | "move" | "add";

export interface ConfirmShiftType {
  key: string;
  label: string;
  default_start_time?: string | null;
  default_end_time?: string | null;
}

/** 这一周的一个时段；employee_id = null 是空班。 */
export interface ConfirmSlot {
  id: number;
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  employee_id: number | null;
  note?: string | null;
  mine: boolean;
}

export interface RequestSlot {
  id: number;
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
}

export interface ConfirmRequest {
  id: number;
  kind: RequestKind;
  status: RequestStatus;
  from: { employee_id: number; name: string };
  /** swap / move：提请求的人拖的那张卡。 */
  my_slot: RequestSlot | null;
  /** 只有 swap：对方的那张卡。 */
  their_slot: RequestSlot | null;
  peer: { employee_id: number; name: string } | null;
  /** move 的目标日、add 的那天。 */
  date: string | null;
  /** 只有 add。 */
  shift_type: string | null;
  /** 到期限对方没回、按开关交给排班的人了。 */
  peer_timed_out?: boolean;
  created_at: string;
  decided_at: string | null;
}

export type ClosedReason = "past_deadline" | "published" | "started";

export interface MyConfirmation {
  /** 这一周周日，YYYY-MM-DD。 */
  week_start: string;
  week_status: "draft" | "published";
  person: { employee_id: number; name: string };
  /** 带时区的 ISO 时间（周四 12:00 PM 洛杉矶）。 */
  deadline: string;
  open: boolean;
  closed_reason: ClosedReason | null;
  /** 只列在用的；加班只能从这里选。 */
  shift_types: ConfirmShiftType[];
  /** 周表的行：只有名字。 */
  employees: { employee_id: number; name: string }[];
  slots: ConfirmSlot[];
  /** 自己的带 kind（pto / sick / personal）；别人的 kind = null，只写 Off。 */
  time_off: { employee_id: number; date: string; kind: string | null }[];
  my_response: { answer: ConfirmAnswer; answered_at: string | null } | null;
  my_requests: ConfirmRequest[];
  /** 别人要跟我换班、还在 awaiting_peer 的。 */
  requests_for_me: ConfirmRequest[];
}

export type ChangeRequestBody =
  | { kind: "swap"; my_slot_id: number; their_slot_id: number }
  | { kind: "move"; my_slot_id: number; date: string }
  | { kind: "add"; date: string; shift_type: string };

/**
 * 排班的人这一边（Responses 卡）。TODO(G138)：改成 4e 最终接口的 people[].answer 多 counted_accepted、
 * 顶层 requests[] 平铺；现在 Responses 卡还按第一版的 people[].requests 读。
 */
export interface LegacyConfirmRequest {
  id: number;
  date: string;
  shift_type: string;
  status: "pending" | "approved" | "declined";
}

export interface ConfirmationPerson {
  employee_id: number;
  name: string;
  /** 还没回是字符串 "no_answer"，不是 null（后端 `week_confirmations` 原样返回）。 */
  answer: ConfirmAnswer | "no_answer" | "counted_accepted";
  answered_at: string | null;
  requests: LegacyConfirmRequest[];
}

export interface WeekConfirmations {
  /** 周三通知发出的时间；还没发 = null。 */
  sent_at: string | null;
  people: ConfirmationPerson[];
}

/** 接口还没上线：404 / 405 / 501 都当没有这个功能。 */
export function isUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 405 || error.status === 501)
  );
}

function base(token?: string): string {
  return token
    ? `/api/schedule/confirmation/link/${encodeURIComponent(token)}`
    : "/api/schedule/confirmation";
}

export function fetchMyConfirmation(
  opts: { week?: string; token?: string },
  signal?: AbortSignal,
): Promise<MyConfirmation> {
  return apiFetch<MyConfirmation>(base(opts.token), {
    cache: "no-store",
    signal,
    query: { week: opts.week },
  });
}

/** Looks good。返回同 GET。 */
export function acceptMyConfirmation(opts: {
  week: string;
  token?: string;
}): Promise<MyConfirmation> {
  return apiFetch<MyConfirmation>(`${base(opts.token)}/accept`, {
    method: "POST",
    body: { week_start: opts.week },
  });
}

/** Send my changes：一次发出这一页上攒的改动。返回同 GET。 */
export function submitMyChanges(opts: {
  week: string;
  token?: string;
  requests: ChangeRequestBody[];
}): Promise<MyConfirmation> {
  return apiFetch<MyConfirmation>(`${base(opts.token)}/changes`, {
    method: "POST",
    body: { week_start: opts.week, requests: opts.requests },
  });
}

/** 别人找我换班：Accept 交给排班的人；Decline 结束、恢复原样。返回同 GET。 */
export function answerPeerRequest(opts: {
  id: number;
  answer: "accept" | "decline";
  token?: string;
}): Promise<MyConfirmation> {
  return apiFetch<MyConfirmation>(
    `${base(opts.token)}/requests/${opts.id}/answer`,
    { method: "POST", body: { answer: opts.answer } },
  );
}

export function fetchWeekConfirmations(
  weekStart: string,
  signal?: AbortSignal,
): Promise<WeekConfirmations> {
  return apiFetch<WeekConfirmations>(
    `/api/schedule/weeks/${weekStart}/confirmations`,
    { cache: "no-store", signal },
  );
}

/** Approve：swap 两个班的人对调；move 挪到目标日；add 按默认时间新建一个他的班。 */
export function approveRequest(id: number): Promise<unknown> {
  return apiFetch<unknown>(
    `/api/schedule/confirmation-requests/${id}/approve`,
    {
      method: "POST",
    },
  );
}

/** Decline：恢复原样，通知本人（换班两个人都通知）。 */
export function declineRequest(id: number): Promise<unknown> {
  return apiFetch<unknown>(
    `/api/schedule/confirmation-requests/${id}/decline`,
    {
      method: "POST",
    },
  );
}
