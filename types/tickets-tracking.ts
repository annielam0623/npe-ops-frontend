/** 门票确认状态。后端改状态接口只认 yes / pending / reschedule_req（cancel 待后端支持）。 */
export type TicketConfirmation =
  "yes" | "pending" | "reschedule_req" | "cancel";

/** GET /api/notifications/tickets-reminder/tracking 的一行（一张门票单）。空值多为空字符串。 */
export interface TicketsTrackingRow {
  /** tickets_reminders.id：对话、Take action 都用它（不是 bookings.id）。 */
  id: number;
  /** CHD 号。 */
  order_number: string;
  confirmation_no: string;
  guest_name: string;
  phone: string;
  email: string;
  quantities: number | null;
  /** 服务日期 YYYY-MM-DD。 */
  tour_date: string;
  /** 产品代码（upper_antelope_tsosie 等）。 */
  tour_type: string;
  checkin_time: string;
  tour_time: string;
  /** 表里的原始邮件状态（Response Rate 用它，同旧页面）。 */
  email_status: string;
  /** send_log 推出来的邮件状态（Email 列用它）。 */
  email_state: "" | "clicked" | "opened" | "delivered" | "sent" | "failed";
  sms_status: string;
  /** 后端默认 pending；也可能是库里的其他旧值。 */
  confirmation_status: string;
  /** 客人提交确认页的时刻（ISO）；没提交为 null。 */
  submitted_at: string | null;
  /** 提交过不止一次。 */
  resubmitted: boolean;
  action_taken_by: string;
  /** 客人在确认页填的留言。 */
  guest_notes: string;
  /** 上传名单那一行的原始列：[[表头, 值], …]；不是上传进来的为 null。 */
  upload_row: [string, string][] | null;

  notes_count: number;
  latest_note_author: string;
  latest_note_body: string;
  latest_note_direction: string;
  latest_note_channel: string;

  wa_count: number;
  latest_wa_author: string;
  latest_wa_body: string;
  latest_wa_direction: string;
  latest_wa_ts: string;
  wa_unhandled: boolean;
  wa_is_newer: boolean;
  wa_in_ts: string;
  wa_fallback: string;
}

export interface TicketsTracking {
  date: string;
  rows: TicketsTrackingRow[];
}

/** GET /api/broadcasting-log?date=&module=tickets 的一条（这天群发过的消息）。 */
export interface BroadcastLogEntry {
  id: number;
  sent_by: string;
  template_name: string | null;
  message_body: string;
  recipient_count: number;
  sms_sent: number;
  sms_failed: number;
  email_sent: number;
  email_failed: number;
  /** "YYYY-MM-DD HH:MM"（洛杉矶）。 */
  created_at: string;
}
