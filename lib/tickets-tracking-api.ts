import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type {
  BroadcastLogEntry,
  TicketsImportPreview,
  TicketsImportResult,
  TicketsImportRow,
  TicketsTracking,
} from "@/types";

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
 * 认 yes / pending / reschedule_req / cancel（后端 2026-10-06 起支持 cancel，`10c2232`）。只写库，不发消息。
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

/**
 * 补录预览：解析名单，标出「这天这个产品的总表里已经有」的单。只读，不写库。
 * ⚠️ 解析失败等后端用 200 + { error } 回，调用方要看 error。
 */
export function previewTicketsImport(input: {
  file: File;
  serviceDate: string;
  tourType: string;
}): Promise<TicketsImportPreview> {
  const form = new FormData();
  form.append("manifest", input.file);
  form.append("service_date", input.serviceDate);
  form.append("tour_type", input.tourType);
  return apiFetch<TicketsImportPreview>(
    "/api/tickets-reminder/tracking-import-preview",
    { method: "POST", body: form },
  );
}

/**
 * 补录写入：把选中的行插进总表（状态 pending）。**不发任何消息**。
 * 有一行算不出人数时整批不写，后端用 200 + { error } 回。
 */
export function commitTicketsImport(input: {
  rows: TicketsImportRow[];
  serviceDate: string;
  tourType: string;
}): Promise<TicketsImportResult> {
  return apiFetch<TicketsImportResult>(
    "/api/tickets-reminder/tracking-import-commit",
    {
      method: "POST",
      body: {
        guests: input.rows,
        service_date: input.serviceDate,
        tour_type: input.tourType,
      },
    },
  );
}
