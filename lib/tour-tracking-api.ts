import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type {
  BroadcastLogEntry,
  TourImportPreview,
  TourImportResult,
  TourImportRow,
  TourTracking,
} from "@/types";

/** staff 及以上可调；纯读。date 为团期 YYYY-MM-DD。 */
export function fetchTourTracking(
  date: string,
  signal?: AbortSignal,
): Promise<TourTracking> {
  return apiFetch<TourTracking>(
    "/api/notifications/tour-confirmation/tracking",
    { cache: "no-store", signal, query: { date } },
  );
}

/** 这天（团期）巴士线群发过的消息，新的在前。 */
export async function fetchTourBroadcasts(
  date: string,
  signal?: AbortSignal,
): Promise<BroadcastLogEntry[]> {
  const result = await apiFetch<{ rows: BroadcastLogEntry[] }>(
    "/api/broadcasting-log",
    { cache: "no-store", signal, query: { date, module: "tour" } },
  );
  return result.rows;
}

/**
 * 改确认状态（yes / modify_req / pending / cancel）。只写库，不发消息。
 * ⚠️ 改成 cancel 后端会把午餐清零、MTLV 张数清零并把票标成 cancel。
 */
export async function updateTourConfirmation(
  bookingId: number,
  confirmation: string,
): Promise<void> {
  await apiFetch(`/api/bookings/${bookingId}/confirmation`, {
    method: "PUT",
    body: { confirmation },
  });
}

/** 改午餐份数（只有 YES 的单能改，否则 400）。 */
export async function updateTourLunch(
  bookingId: number,
  lunch: { turkey: number; veggie: number; beef: number },
): Promise<void> {
  await apiFetch(`/api/bookings/${bookingId}/lunch`, {
    method: "PUT",
    body: {
      lunch_turkey: lunch.turkey,
      lunch_veggie: lunch.veggie,
      lunch_beef: lunch.beef,
    },
  });
}

/** MTLV 票的状态：pending_send / sent（记谁、何时）/ cancel（张数清零）。 */
export async function updateMtlvTicketStatus(
  bookingId: number,
  status: "pending_send" | "sent" | "cancel",
): Promise<void> {
  await apiFetch(`/api/bookings/${bookingId}/mtlv-ticket-status`, {
    method: "PUT",
    body: { mtlv_ticket_status: status },
  });
}

/**
 * CSV 导出（旧页面同一个地址）：这天的全部巴士单，先是上传名单的全部列，再是状态列。
 * 浏览器直接打开这个同源地址下载，cookie 随请求带上。
 */
export function buildTourExportUrl(date: string): string {
  return `/api/notifications/tour-confirmation/export-csv?${buildQueryString({ date })}`;
}

/**
 * 补录预览：解析名单，标出这天的列表里已经有的单。只读，不写库。解析失败 400（detail 是原因）。
 * /send/tour-tracking-import-* 不在 /api 下，next.config.ts 单独加了转发。
 */
export function previewTourImport(input: {
  file: File;
  tourDate: string;
  tourType: string;
}): Promise<TourImportPreview> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("tour_date", input.tourDate);
  form.append("tour_type", input.tourType);
  return apiFetch<TourImportPreview>("/send/tour-tracking-import-preview", {
    method: "POST",
    body: form,
    cache: "no-store",
  });
}

/**
 * 补录写入：把选中的行插进这天的列表（状态 pending）。**不发任何消息**。
 * 有一行算不出人数时整批 400。
 */
export function commitTourImport(input: {
  rows: TourImportRow[];
  tourDate: string;
  tourType: string;
}): Promise<TourImportResult> {
  return apiFetch<TourImportResult>("/send/tour-tracking-import-commit", {
    method: "POST",
    body: {
      guests: input.rows,
      tour_date: input.tourDate,
      tour_type: input.tourType,
    },
    cache: "no-store",
  });
}
