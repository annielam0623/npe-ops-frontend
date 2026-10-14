/** GET /api/notifications/tour-confirmation/tracking 的一行（一单，bookings 表）。 */
export interface TourTrackingRow {
  /** bookings.id：改状态 / 午餐 / MTLV 票、Take action 都按它。 */
  id: number;
  order_number: string;
  first_name: string;
  /** 接口有（b.last_name）；没有 guest_name 时和 first_name 拼成姓名（同旧页面）。 */
  last_name?: string | null;
  guest_name: string;
  email: string;
  phone: string;
  quantities: number | string | null;
  pickup_time: string;
  pickup_location: string;
  /**
   * 对上 Settings → Pickup Locations 的哪一家（后端 2026-10-09 `a5b3bfd`，唯一判据 pickup_lookup.match_with_reason()）。
   * 0 / "" = 对不上（不猜）。群发「By pickup location」按它分组。旧后端没有这两项时当作对不上。
   */
  pickup_location_id?: number;
  pickup_hotel_name?: string;
  tour_date: string;
  tour_type: string;
  /** bookings 表里发信当时写的原值（回复率的分母用它）。 */
  email_status: string;
  /** send_log 推出来的投递阶梯：clicked / opened / delivered / sent / failed / ""。 */
  email_state: string;
  sms_status: string;
  /**
   * yes / modify_req / modified / pending / cancel。modified（后端 2026-10-10 `7c03bd3`）= staff 已和客人敲定改期，
   * 不再算待处理；不改人数 / 午餐数（那些只看 Rezdy）。
   */
  confirmation_status: string;
  lunch_turkey: number;
  lunch_veggie: number;
  lunch_beef: number;
  /** 客人在确认页留的话（Notes 列没有消息时显示它）。 */
  notes: string;
  submission_count: number;
  /** 已按洛杉矶格式化好的字符串，没有为 ""。 */
  submitted_at: string;
  /** [[列名, 值], …]；老订单为 null。 */
  upload_row: [string, string][] | null;
  mtlv_eligible: boolean;
  /** 客人回了几张；null = 还没回。 */
  mtlv_qty: number | null;
  /** pending_send / sent / cancel / null。 */
  mtlv_ticket_status: string | null;
  mtlv_ticket_sent_by: string;
  mtlv_ticket_sent_at: string;
  action_taken_by: string;

  notes_count: number;
  latest_note_author: string;
  latest_note_body: string;
  latest_note_direction: string;
  latest_note_channel: string;
  /**
   * Notes 列还要不要显示 ⚠️ Take action（后端 2026-10-10 `7c03bd3`，判据同 dashboard 未处理窗口）：
   * 最新一条客人留言 / 改期请求在最后一次 Take action 之后。不能单看 action_taken_by。
   */
  notes_unhandled: boolean;
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

export interface TourTracking {
  date: string;
  rows: TourTrackingRow[];
}

/** 补录预览的一行（解析出来的 manifest 行 + 是否已在这天的列表里）。 */
export interface TourImportRow {
  order_number: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  quantities?: string | number;
  pickup_time?: string;
  pickup_location?: string;
  mtlv_promo?: string | number | null;
  duplicate: boolean;
  pax?: number;
  pax_ok?: boolean;
  qty_label?: string;
  [key: string]: unknown;
}

export interface TourImportPreview {
  total: number;
  rows: TourImportRow[];
  warning?: string;
}

export interface TourImportResult {
  inserted: number;
  failed: number;
  errors: { order_number: string; error: string }[];
}
