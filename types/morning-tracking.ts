/** GET /api/notifications/morning-pickup/tracking 的一行（一单）。空值是空字符串，不是 null。 */
export interface MorningTrackingRow {
  /** bookings.id，Take action 用。 */
  id: number;
  order_number: string;
  name: string;
  phone: string;
  email: string;
  quantities: number;
  pickup_time: string;
  pickup_location: string;
  driver: string;
  vehicle_no: string;
  /** 这台车的 Samsara 实时位置链接；车号对不上车辆表或没有 GPS 时为 ""（后端 2026-10-04 加）。 */
  samsara_url?: string;
  /**
   * staff 看这台车实时位置的入口（后端 `/tracking/vehicle-live?van=`，绝对地址、要登录旧后台）：
   * 开了 Samsara API 时现建当天有效的临时链接，没开时跳 samsara_url。有没有值的判据同 samsara_url（后端 2026-10-05，规则文档 5c）。
   */
  live_url?: string;
  /** 原始短信状态（例 "sent:SM…"、"delivered"、"undelivered"），前端按子串归类。 */
  sms_status: string;
  email_state: "" | "clicked" | "opened" | "delivered" | "sent" | "failed";
  checkin_status: "checked_in" | "pending";
  /** 带时区的 ISO；没签到为 null。 */
  checkin_time: string | null;
  /** 谁处理过（显示名）；没处理为空。 */
  action_taken_by: string;
  agent_name: string;

  /** Notes 列：除 WhatsApp 以外的对话（短信 / 邮件 / 网页 / 内部备注）。 */
  notes_count: number;
  latest_note_author: string;
  latest_note_body: string;
  latest_note_direction: string;
  latest_note_channel: string;

  /** WhatsApp 列。 */
  wa_count: number;
  latest_wa_author: string;
  latest_wa_body: string;
  latest_wa_direction: string;
  /** 最新一条 WhatsApp（不分方向）的 ISO，排序用。 */
  latest_wa_ts: string;
  /** 最新一条 WhatsApp 是客人发的、且之后没人 Take action。 */
  wa_unhandled: boolean;
  /** WhatsApp 比 Notes 新：Take action 链接放在 WhatsApp 列。 */
  wa_is_newer: boolean;
  /** 客人最近一条**入站** WhatsApp 的 ISO，24 小时窗口从这里算。 */
  wa_in_ts: string;
  /** 窗口关了以后改用的渠道：sms / email / 空。 */
  wa_fallback: string;
}

export interface MorningTracking {
  date: string;
  /** 早班追踪窗口结束（洛杉矶，一天里的第几分钟 / 显示文字）。过了就停止自动刷新。 */
  tracking_window: { end_minute: number; end_label: string };
  rows: MorningTrackingRow[];
}

/** GET /booking-notes/by-order/{order}?line=… 的一条。 */
export interface BookingNote {
  id: number;
  booking_id: number;
  /** 显示名，没有时是用户名；客人发来的为空。 */
  author_username: string;
  direction: string;
  body: string;
  sms_status: string | null;
  email_status: string | null;
  /** "YYYY-MM-DD HH:MM"，洛杉矶时间，只用来显示和排序。 */
  created_at: string;
}

export interface BookingNotes {
  notes: BookingNote[];
  guest_note: string;
  action_taken_by: string;
}

/** 对话所属的线；决定读写哪些 module 的备注。 */
export type NoteLine = "morning" | "tour" | "tickets";

export interface NoteCreate {
  body: string;
  direction: "staff_note" | "sms_out";
  send_sms: boolean;
  send_email: boolean;
  /** 不传 = 老行为（module 留空）；早班页传 morning。 */
  line?: NoteLine;
}

export interface TakeActionResult {
  ok: boolean;
  action_taken_by: string;
  action_taken_at: string | null;
}
