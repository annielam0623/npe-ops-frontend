import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/types";

/**
 * 周三确认下周排班（Annie 2026-10-19「现在动手」；preview https://claude.ai/artifact/WR2LTx5YTFSmZ9HoMyiFPH）。
 * ⚠️ 后端还没有这些接口（G138 明天出草案）：下面的形状是 ops 按 preview 自己拟的，接口形状一到就对齐。
 * 接口没上线（404 / 501）时页面整块不显示、不报错（`isUnavailable`）。
 *
 * 员工这一边有两种进法，响应形状一样：
 *  - 登录后：`/api/schedule/confirmation?week=YYYY-MM-DD`（week 不传 = 后端挑下一个要确认的周）；
 *  - 邮件里的链接（不用登录，一人一条、过期失效）：`/api/schedule/confirmation/link/{token}`。
 * 排班的人这一边：`GET /api/schedule/weeks/{week}/confirmations`，Approve / Decline 一条想加的班。
 */

export type ConfirmAnswer = "accepted" | "changes";
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
  /** 还能不能回（过了期限 / 排班的人关了 = false）。 */
  open?: boolean;
}

export interface ConfirmationPerson {
  employee_id: number;
  name: string;
  /** null = 还没回。 */
  answer: ConfirmAnswer | null;
  answered_at: string | null;
  requests: ConfirmRequest[];
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
    query: opts.token ? undefined : { week: opts.week },
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
