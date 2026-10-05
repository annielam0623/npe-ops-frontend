import { apiFetch } from "@/lib/api-client";
import type {
  BroadcastLogEntry,
  BroadcastOrderHit,
  BroadcastRecipientRow,
} from "@/types";

export interface BroadcastLogQuery {
  /** 按**发送时间**（洛杉矶日期）筛，两头都含；空 = 不限。 */
  sentFrom: string;
  sentTo: string;
  module: string;
  group: string;
}

/** staff 及以上可调；纯读。新的在前，没有分页。 */
export async function fetchBroadcastLog(
  query: BroadcastLogQuery,
  signal?: AbortSignal,
): Promise<BroadcastLogEntry[]> {
  const result = await apiFetch<{ rows: BroadcastLogEntry[] }>(
    "/api/broadcasting-log",
    {
      cache: "no-store",
      signal,
      query: {
        sent_from: query.sentFrom || undefined,
        sent_to: query.sentTo || undefined,
        module: query.module || undefined,
        group: query.group || undefined,
      },
    },
  );
  return result.rows;
}

/** 按订单号查最多返回多少行（后端上限 500，默认 200）。 */
export const BROADCAST_ORDER_LIMIT = 200;

/**
 * 按订单号「包含」查，不限日期：每个匹配的收件人一行，新的在前。
 * `truncated` = 还有更多没返回（只输一两个字时会匹配很多），没有分页。
 */
export function fetchBroadcastsByOrder(
  orderNumber: string,
  signal?: AbortSignal,
): Promise<{ rows: BroadcastOrderHit[]; truncated: boolean }> {
  return apiFetch("/api/broadcasting-log/by-order", {
    cache: "no-store",
    signal,
    query: { order_number: orderNumber, limit: BROADCAST_ORDER_LIMIT },
  });
}

/** 一次群发的收件人（按发送顺序）。 */
export async function fetchBroadcastRecipients(
  id: number,
  signal?: AbortSignal,
): Promise<BroadcastRecipientRow[]> {
  const result = await apiFetch<{ recipients: BroadcastRecipientRow[] }>(
    `/api/broadcasting-log/${id}/recipients`,
    { cache: "no-store", signal },
  );
  return result.recipients;
}
