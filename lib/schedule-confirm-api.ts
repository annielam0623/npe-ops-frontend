import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/types";

/**
 * 周三确认下周排班（Annie 2026-10-19「现在动手」；preview https://claude.ai/artifact/WR2LTx5YTFSmZ9HoMyiFPH）。
 * 后端已上线（2026-10-20，`npe-confirmation-service` `4368567`，接口说明
 * `docs/interfaces/schedule-wed-confirm-2026-10-20.md`）；接口没上线前的旧版本会 404 / 501，
 * 仍按 `isUnavailable` 的判法兼容老环境（页面整块不显示、不报错）。
 *
 * 员工这一边有两种进法，响应形状一样：
 *  - 登录后：`/api/schedule/confirmation?week=YYYY-MM-DD`；
 *  - 邮件里的链接（不用登录，一人一条、过期失效）：`/api/schedule/confirmation/link/{token}?week=YYYY-MM-DD`
 *    （token 模式同样要带 `week`，后端两个路径的 handler 都要求这个查询参数）。
 * 排班的人这一边：`GET /api/schedule/weeks/{week}/confirmations`，Approve / Decline 一条想加的班。
 */

export type ConfirmAnswer = "accepted" | "wants_changes";
/** 一条「想加的班」：pending 等排班的人处理；approved 变成正式的班；declined 被拒（本人收到通知）。 */
export type RequestStatus = "pending" | "approved" | "declined";

export interface ConfirmShiftType {
  key: string;
  label: string;
}

/** 这一周的一个时段（含谁排上了）；没排到人的时段不给。 */
export interface ConfirmSlot {
  id: number;
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  employee_id: number;
  employee_name: string;
}

export interface ConfirmRequest {
  id: number;
  date: string;
  shift_type: string;
  status: RequestStatus;
}

export interface MyConfirmation {
  /** 这一周周日，YYYY-MM-DD。 */
  week_start: string;
  person: { employee_id: number; name: string };
  shift_types: ConfirmShiftType[];
  slots: ConfirmSlot[];
  /** 回过了才有；没回 = null。 */
  my_response: {
    answer: ConfirmAnswer;
    answered_at: string | null;
    requests: ConfirmRequest[];
  } | null;
  /** 这一周还没开始（今天 < week_start）才能回应；一旦这一周已经开始自动只读。后端总是带这个字段。 */
  open: boolean;
}

export interface ConfirmationPerson {
  employee_id: number;
  name: string;
  /** 还没回是字符串 "no_answer"，不是 null（后端 `week_confirmations` 原样返回）。 */
  answer: ConfirmAnswer | "no_answer";
  answered_at: string | null;
  requests: ConfirmRequest[];
  /** 这个人这一周有几条往来记录（后端 schedule-history，History (N) 直接用，不用逐人读）；旧后端没有。 */
  history_count?: number;
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

export function acceptMyConfirmation(opts: {
  week: string;
  token?: string;
}): Promise<unknown> {
  return apiFetch<unknown>(`${base(opts.token)}/accept`, {
    method: "POST",
    body: { week_start: opts.week },
  });
}

/** 想加的班：只加不减；一次发送，之后不能再改。 */
export function submitMyChanges(opts: {
  week: string;
  token?: string;
  additions: { date: string; shift_type: string }[];
}): Promise<unknown> {
  return apiFetch<unknown>(`${base(opts.token)}/changes`, {
    method: "POST",
    body: { week_start: opts.week, additions: opts.additions },
  });
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

/** Approve：变成正式的班（后端加一个时段 + 通知本人）。 */
export function approveRequest(id: number): Promise<unknown> {
  return apiFetch<unknown>(
    `/api/schedule/confirmation-requests/${id}/approve`,
    {
      method: "POST",
    },
  );
}

/** Decline：亮黄色消失，通知本人；本人原来的班没动。 */
export function declineRequest(id: number): Promise<unknown> {
  return apiFetch<unknown>(
    `/api/schedule/confirmation-requests/${id}/decline`,
    {
      method: "POST",
    },
  );
}
