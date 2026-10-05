import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type {
  SendBatch,
  SendBatchDetail,
  SendLogPage,
  SendLogQuery,
} from "@/types";

export const SEND_LOG_PAGE_SIZE = 50;

/** staff 及以上可调；纯读。空字符串的筛选项不传。 */
export function fetchSendLog(
  query: SendLogQuery,
  signal?: AbortSignal,
): Promise<SendLogPage> {
  return apiFetch<SendLogPage>("/api/notifications/send-log", {
    cache: "no-store",
    signal,
    query: {
      date_from: query.from,
      date_to: query.to,
      mtlv_eligible: query.mtlv ? true : undefined,
      module: query.module || undefined,
      channel: query.channel || undefined,
      status: query.status || undefined,
      page: query.page,
      page_size: SEND_LOG_PAGE_SIZE,
    },
  });
}

/**
 * CSV 导出（旧页面同一个地址）：按洛杉矶日期范围、可选模块过滤，不支持渠道 / 状态 / MTLV。
 * 浏览器直接打开这个同源地址下载，cookie 随请求带上。
 */
export function buildSendLogExportUrl(
  query: Pick<SendLogQuery, "from" | "to" | "module">,
): string {
  const qs = buildQueryString({
    date_from: query.from,
    date_to: query.to,
    module: query.module || undefined,
  });
  return `/api/send-log/export?${qs}`;
}

/** 发送页「View this send」：Send Log 里这一批展开（新标签页打开）。 */
export function sendBatchHref(batchId: number): string {
  return `/send-log?batch=${encodeURIComponent(String(batchId))}`;
}

/** 「Send batches」：按开始发送的洛杉矶日期（含两端），新的在前。 */
export async function fetchSendBatches(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<SendBatch[]> {
  const res = await apiFetch<{ batches: SendBatch[] }>("/api/send-batches", {
    cache: "no-store",
    signal,
    query: { date_from: from, date_to: to },
  });
  return res.batches ?? [];
}

/** 一批的小结 + 逐单明细 + 跳过的单。没有这一批 404。 */
export function fetchSendBatch(
  id: number,
  signal?: AbortSignal,
): Promise<SendBatchDetail> {
  return apiFetch<SendBatchDetail>(`/api/send-batches/${id}`, {
    cache: "no-store",
    signal,
  });
}
