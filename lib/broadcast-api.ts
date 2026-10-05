import { apiFetch } from "@/lib/api-client";

export interface BroadcastTemplate {
  /** 槽位号（t1..t8），staff 看不到。 */
  name: string;
  label: string;
  body: string;
}

export interface BroadcastTemplateSet {
  templates: BroadcastTemplate[];
  /** 自动追加在正文后面的签名；空串 = 不追加。 */
  signature: string;
}

/** Content Studio 里的群发模板：tour = 巴士线，tix = 门票线。 */
export async function fetchBroadcastTemplates(
  set: "tour" | "tix",
): Promise<BroadcastTemplateSet> {
  const data = await apiFetch<Record<string, BroadcastTemplateSet | undefined>>(
    "/api/broadcast-templates",
    { cache: "no-store" },
  );
  const value = data[set];
  if (
    !value ||
    !Array.isArray(value.templates) ||
    typeof value.signature !== "string"
  ) {
    throw new Error("Unexpected template payload");
  }
  return value;
}

export interface BroadcastRecipient {
  order_number: string;
  customer_name: string;
  first_name: string;
  phone: string;
  email: string;
}

export interface BroadcastSendInput {
  module: "tickets" | "tour";
  /** 门票页 all / pending / sent；Tour 页 general / mtlv。 */
  group_filter: "all" | "pending" | "sent" | "general" | "mtlv";
  status_filter: "all";
  tour_date: string;
  /** 存进群发记录的产品名（当时屏幕上的短名）。 */
  product_label: string;
  /** 模板标题；直接打字为 null（记录里显示 Custom message）。 */
  template_name: string | null;
  /** 正文 + 签名。{first_name} / {tour_date} 由后端逐人展开。 */
  message_body: string;
  recipients: BroadcastRecipient[];
  send_sms: boolean;
  send_email: boolean;
}

export interface BroadcastSendResult {
  broadcast_id: number;
  recipient_count: number;
  sms_sent: number;
  sms_failed: number;
  email_sent: number;
  email_failed: number;
}

/**
 * ⚠️ 群发：**真实**给每位收件人发短信 / 邮件，并写群发记录。
 * /booking-notes/broadcast/send 不在 /api 下，next.config.ts 单独加了这一条转发。
 */
export function sendBroadcast(
  input: BroadcastSendInput,
): Promise<BroadcastSendResult> {
  return apiFetch<BroadcastSendResult>("/booking-notes/broadcast/send", {
    method: "POST",
    body: input,
  });
}
