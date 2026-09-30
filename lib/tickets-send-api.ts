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

/** ⚠️ 真实发送：给这一批客人发短信 / 邮件，并写 send_log。 */
export function sendTicketsBatch(
  sendType: TicketsSendType,
  guests: TicketsGuest[],
): Promise<TicketsSendBulkResponse> {
  return apiFetch<TicketsSendBulkResponse>("/api/tickets-reminder/send-bulk", {
    method: "POST",
    body: { send_type: sendType, guests },
    cache: "no-store",
  });
}
