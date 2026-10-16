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
  /** 门票页 all / pending / sent；Tour 页 general / mtlv，按接站点选人时是 pickup。 */
  group_filter: "all" | "pending" | "sent" | "general" | "mtlv" | "pickup";
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
  /** 收过一模一样消息、这次照发的订单号（G62）；要和 preview_at 一起带。 */
  send_anyway?: string[];
  /** /broadcast/check 回的 checked_at。 */
  preview_at?: string;
}

/** 这一单这个团期已经收过一模一样的消息（G62）。 */
export interface BroadcastAlreadySent {
  order_number: string;
  sent_at: string;
  sent_by: string;
}

export interface BroadcastCheckResult {
  checked_at: string;
  already_sent: BroadcastAlreadySent[];
}

/** 发之前看谁这个团期已经收过一模一样的消息（只读，G62；和 Manifests 的群发互认）。 */
export function checkBroadcast(input: {
  tour_date: string;
  message_body: string;
  order_numbers: string[];
}): Promise<BroadcastCheckResult> {
  return apiFetch<BroadcastCheckResult>("/booking-notes/broadcast/check", {
    method: "POST",
    body: input,
    cache: "no-store",
  });
}

export interface BroadcastSendResult {
  /** 全部被跳过时 null（不记群发记录）。 */
  broadcast_id: number | null;
  recipient_count: number;
  sms_sent: number;
  sms_failed: number;
  email_sent: number;
  email_failed: number;
  /** 收过一模一样消息、这次跳过的（G62）。 */
  skipped?: BroadcastAlreadySent[];
  checked_at?: string;
}

/**
 * ⚠️ 群发：**真实**给每位收件人发短信 / 邮件，并写群发记录。
 * 收过一模一样消息的默认跳过；同一团期同时只能一个群发（409，什么都没发）。
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
