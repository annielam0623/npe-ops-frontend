import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type { MorningTracking } from "@/types";

/** staff 及以上可调；纯读。date 为洛杉矶日期 YYYY-MM-DD。 */
export function fetchMorningTracking(
  date: string,
  signal?: AbortSignal,
): Promise<MorningTracking> {
  return apiFetch<MorningTracking>(
    "/api/notifications/morning-pickup/tracking",
    {
      cache: "no-store",
      signal,
      query: { date },
    },
  );
}

/**
 * 导出 xlsx（旧页面同一个地址）。⚠️ 数据来自 send_log（这天发过的早班提醒），
 * 不是表格里的签到行。浏览器直接打开这个同源地址下载，cookie 随请求带上。
 */
export function buildMorningExportUrl(date: string): string {
  return `/api/notifications/morning-pickup/export?${buildQueryString({ date })}`;
}
