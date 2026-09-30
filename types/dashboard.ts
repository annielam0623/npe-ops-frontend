/** Dashboard Messages 区的三个窗口：Today's Pickup / Tour / Tickets。 */
export type MessageLane = "morning" | "tour" | "tickets";

/**
 * GET /api/notifications/unhandled 里的一张卡片：一单还欠着一个回应（客人来信或要求改期）。
 * 时刻都是带时区的 ISO 字符串，取不到时是空字符串（不是 null）。
 */
export interface UnhandledMessage {
  order_number: string;
  name: string;
  /** 团名；借不到时为空，改显示 trip_fallback（接客点）。 */
  trip: string;
  trip_fallback: string;
  /** whatsapp / sms / email；老数据可能为空，再看 direction。 */
  channel: string;
  /** WhatsApp 24 小时窗口关了以后建议改用的渠道：sms / email；算不出来为空。 */
  fallback_channel: string;
  /** sms_in / email_in / guest_reply 等；只有改期、没有消息的卡片为空。 */
  direction: string;
  body: string;
  /** 客人最后一条消息的时刻；只有改期、没有消息时为空。 */
  created_at: string;
  /** 「欠着多久了」的基准：消息时间和提改期时间里较晚的那个。 */
  pending_since: string;
  is_modify: boolean;
  /** YYYY-MM-DD */
  tour_date: string;
  /** 旧后台 tracking 页的站内路径（带 ?date=），处理消息要去那里。 */
  track_url: string;
}

export interface UnhandledMessages {
  /** 洛杉矶的今天，YYYY-MM-DD。 */
  today: string;
  /** 早班追踪窗口的结束时刻，例如 "10:30 AM"。 */
  window_end: string;
  /** 后端已排好序：WhatsApp / 改期在前（最新在前），其余按出发日。 */
  lanes: Record<MessageLane, UnhandledMessage[]>;
  /** 三个窗口之和。 */
  count: number;
}
