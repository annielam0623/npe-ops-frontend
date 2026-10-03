import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type { BroadcastLogEntry, TicketsTracking } from "@/types";

/** staff 及以上可调；纯读。date 为服务日期 YYYY-MM-DD。 */
export function fetchTicketsTracking(
  date: string,
  signal?: AbortSignal,
): Promise<TicketsTracking> {
  return apiFetch<TicketsTracking>(
    "/api/notifications/tickets-reminder/tracking",
    { cache: "no-store", signal, query: { date } },
  );
}

/** 这天（团期）门票线群发过的消息，新的在前。 */
export async function fetchTicketsBroadcasts(
  date: string,
  signal?: AbortSignal,
): Promise<BroadcastLogEntry[]> {
  const result = await apiFetch<{ rows: BroadcastLogEntry[] }>(
    "/api/broadcasting-log",
    { cache: "no-store", signal, query: { date, module: "tickets" } },
  );
  return result.rows;
}

/**
 * 改确认状态。⚠️ 后端按「CHD 号 + 服务日期」更新，同一单同一天的几个产品会一起改；
 * 只认 yes / pending / reschedule_req，cancel 会 400（待后端支持）。只写库，不发消息。
 */
export async function updateTicketStatus(input: {
  orderNumber: string;
  serviceDate: string;
  confirmation: string;
}): Promise<void> {
  await apiFetch("/api/tickets-reminder/update-status", {
    method: "POST",
    body: {
      chd_number: input.orderNumber,
      service_date: input.serviceDate,
      confirmation: input.confirmation,
    },
  });
}

/**
 * CSV 导出（旧页面同一个地址）：这天的全部门票单，先是上传名单的全部列，再是状态列。
 * 浏览器直接打开这个同源地址下载，cookie 随请求带上。
 */
export function buildTicketsExportUrl(date: string): string {
  return `/api/notifications/tickets-reminder/export-csv?${buildQueryString({ date })}`;
}
