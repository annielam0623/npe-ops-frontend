import { apiFetch } from "@/lib/api-client";
import type {
  MorningResponseStats,
  OpsRange,
  SendStats,
  TicketsResponseStats,
  TourResponseStats,
} from "@/types";

export interface OpsQuery {
  range: OpsRange;
  /** 只在 custom 时传，YYYY-MM-DD。 */
  dateFrom?: string;
  dateTo?: string;
}

/**
 * 四个只读统计，按**发送日期**算（不是团期）。全部 require_staff。
 * ⚠️ 后端把 custom 的日期直接拼进 SQL（待办 B98），所以前端只传校验过的 YYYY-MM-DD。
 */
function get<T>(path: string, q: OpsQuery, signal?: AbortSignal): Promise<T> {
  return apiFetch<T>(`/api/ops-summary/${path}`, {
    cache: "no-store",
    signal,
    query: {
      range: q.range,
      date_from: q.range === "custom" ? q.dateFrom : undefined,
      date_to: q.range === "custom" ? q.dateTo : undefined,
    },
  });
}

export const fetchSendStats = (q: OpsQuery, s?: AbortSignal) =>
  get<SendStats>("send-stats", q, s);
export const fetchTourResponse = (q: OpsQuery, s?: AbortSignal) =>
  get<TourResponseStats>("response-stats", q, s);
export const fetchTicketsResponse = (q: OpsQuery, s?: AbortSignal) =>
  get<TicketsResponseStats>("tickets-response-stats", q, s);
export const fetchMorningResponse = (q: OpsQuery, s?: AbortSignal) =>
  get<MorningResponseStats>("morning-response-stats", q, s);
