import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type { SendLogPage, SendLogQuery } from "@/types";

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
      date: query.date,
      module: query.module || undefined,
      channel: query.channel || undefined,
      status: query.status || undefined,
      page: query.page,
      page_size: SEND_LOG_PAGE_SIZE,
    },
  });
}

/**
 * CSV 导出（旧页面同一个地址）：按洛杉矶日期、可选模块过滤，不支持渠道 / 状态。
 * 浏览器直接打开这个同源地址下载，cookie 随请求带上。
 */
export function buildSendLogExportUrl(
  query: Pick<SendLogQuery, "date" | "module">,
): string {
  const qs = buildQueryString({
    date: query.date,
    module: query.module || undefined,
  });
  return `/api/send-log/export?${qs}`;
}
