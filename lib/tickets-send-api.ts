import { apiFetch } from "@/lib/api-client";
import type {
  TicketsDuplicateCheck,
  TicketsGuest,
  TicketsMessagePreview,
  TicketsSendBulkResponse,
  TicketsSendType,
} from "@/types";

/** 用示例客人渲染这个团型、这一天客人会收到的短信 / 邮件 / 确认页。纯读。 */
export function fetchTicketsMessagePreview(
  tourType: string,
  serviceDate: string,
  signal?: AbortSignal,
): Promise<TicketsMessagePreview> {
  return apiFetch<TicketsMessagePreview>(
    "/api/notifications/tickets-reminder/message-preview",
    {
      cache: "no-store",
      signal,
      query: { tour_type: tourType, service_date: serviceDate },
    },
  );
}

/** 上传 manifest：解析 Excel，并标出这一天 + 这个产品已经发过的订单。不发送任何东西。 */
export function checkTicketsDuplicates(
  file: File,
  tourType: string,
  serviceDate: string,
): Promise<TicketsDuplicateCheck> {
  const form = new FormData();
  form.append("manifest", file);
  form.append("tour_type", tourType);
  form.append("service_date", serviceDate);
  return apiFetch<TicketsDuplicateCheck>(
    "/api/tickets-reminder/check-duplicates",
    { method: "POST", body: form, cache: "no-store" },
  );
}

/**
 * 重新上传后「Apply」：Added 的单插进系统、Changed 的单改成新文件里的值。**不发任何消息**，
 * 不动发送状态和确认状态；Removed 的单不碰。整批一个事务。
 */
export function applyTicketsUpload(
  serviceDate: string,
  tourType: string,
  guests: TicketsGuest[],
): Promise<{ updated: number; added: number }> {
  return apiFetch("/api/tickets-reminder/apply", {
    method: "POST",
    body: { service_date: serviceDate, tour_type: tourType, guests },
    cache: "no-store",
  });
}

/**
 * ⚠️ 真实发送：给这一批客人发短信 / 邮件，并写 send_log。
 * 服务端发每位客人前都再查一次重：发过的跳过（回在 skipped 里）；只有 sendAnyway 里列了、
 * 而且最近一次发送早于 previewAt 的才再发一次——页面怎么重试都不会把同一单发第二次。
 * 400 = 服务端在发第一条之前就整批拒了，这一批什么都没发。
 */
export function sendTicketsBatch(
  sendType: TicketsSendType,
  guests: TicketsGuest[],
  sendAnyway: string[],
  previewAt: string,
): Promise<TicketsSendBulkResponse> {
  return apiFetch<TicketsSendBulkResponse>("/api/tickets-reminder/send-bulk", {
    method: "POST",
    body: {
      send_type: sendType,
      guests,
      send_anyway: sendAnyway,
      preview_at: previewAt,
    },
    cache: "no-store",
  });
}
