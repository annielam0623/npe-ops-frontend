/**
 * Farm out（转单，G40）——后端已上线，形状以代码为准（`app/routers/farm_out*.py`、`app/services/farm_out_*.py`，
 * 文档 `docs/interfaces/farm-out-2026-10-16.md` 第八节；2026-10-17 对着代码核对过）。
 * 所有新字段都是可选，后端没上线时页面和现在一样。
 */

/** 一张订单当前坐在 Farm out 车上时才有（seating 订单里的 `farm_out`）。时间 "HH:MM" 24 小时制。 */
export interface FarmOutOrder {
  partner_id: number;
  /** 只显示；后端 `farm_out_object()` 带的，不送回。 */
  partner_name?: string;
  partner_location_id: number | null;
  hotel_name?: string;
  checkin_time: string | null;
  checkin_time_set_by_staff: boolean;
  depart_time: string | null;
  depart_time_set_by_staff: boolean;
  payable_amount: number | null;
  payable_set_by_staff: boolean;
  payable_changed_by: string | null;
  payable_changed_at: string | null;
  notice_sent_at: string | null;
  notice_sent_by: string | null;
}

/** PATCH /orders/{order} 的返回：`{ok, farm_out: {..., missing}}`；missing = 这单还缺什么（人话，英文）。 */
export interface FarmOutOrderPatched extends FarmOutOrder {
  missing: string[];
}

export interface FarmOutPartner {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
}

export interface FarmOutRate {
  manifest_id: number;
  tour_name: string;
  /** null = 没设。 */
  adult_price: number | null;
  child_price: number | null;
}

export interface FarmOutLocation {
  /** 新加的上车点没有 id。 */
  id: number | null;
  hotel_name: string;
  spot: string;
  address: string;
  map_link: string;
  sort_order: number;
}

export interface FarmOutTimetable {
  /** `id` 为 null = 上传文件里的新酒店（只出现在 parse 返回的 parsed 里，Apply 时才建）；没有 spot。 */
  hotels: { id: number | null; hotel_name: string }[];
  tours: { manifest_id: number; tour_name: string }[];
  /**
   * key = `<hotel_id>_<manifest_id>`，值 "HH:MM"（发车时间）。parse 返回里新酒店的 key 是
   * `new<它在 hotels 里的序号>_<manifest_id>`。
   */
  cells: Record<string, string>;
}

export interface FarmOutTimetableDiff {
  /** from / to 是 "HH:MM"，没有就是空串。 */
  changed: {
    hotel: string;
    tour: string;
    from: string | null;
    to: string | null;
  }[];
  new_hotels: string[];
  unmatched_tours: string[];
}

export interface FarmOutTimetableParse {
  diff: FarmOutTimetableDiff;
  parsed: FarmOutTimetable;
}

/** 按团共用的预计返回时间 / PLEASE NOTE；空串 = 不显示。 */
export interface FarmOutTourMeta {
  manifest_id: number;
  tour_name: string;
  estimated_return_time: string;
  please_note: string;
}

export interface FarmOutNoticePreview {
  manifest_id?: number;
  order_number: string;
  name?: string;
  has_phone?: boolean;
  has_email?: boolean;
  channel_text: {
    email_subject: string;
    email_body: string;
    sms_body: string;
  };
  /** 这单缺什么（"pick-up location" / "departure time"）；非空就不能发。 */
  missing: string[];
  /** send_log 里这个团期已经发出去过（至少一个渠道成功）；没发过 = null。比 seating 里的 notice_sent_at 可靠（重新转单会清后者）。 */
  already_sent?: { sent_at: string; sent_by: string } | null;
}

export interface FarmOutNoticeResult {
  order_number: string;
  name: string;
  /** "sent" / "failed: 原因" / "skipped - no email"；这个渠道没发 = null。 */
  email_status: string | null;
  /** "sent:<sid>" / "failed: 原因" / "skipped - no phone"；这个渠道没发 = null。 */
  sms_status: string | null;
  /** true = 消息发出去了但 Send Log 没记上（去重会漏）：发之前先人工查。 */
  log_failed?: boolean;
}

/** 整单没发：缺资料，或短信超长 / 有特殊字符（missing 里是人话）。 */
export interface FarmOutNoticeBlocked {
  manifest_id: number;
  order_number: string;
  missing: string[];
}

/** 已经发过、这次没勾 send_anyway，所以没发。 */
export interface FarmOutNoticeSkipped {
  order_number: string;
  sent_at: string;
  sent_by: string;
}

export interface FarmOutNoticeSendResponse {
  ok?: boolean;
  total: number;
  sent: number;
  failed: number;
  skipped?: number;
  results: FarmOutNoticeResult[];
  blocked?: FarmOutNoticeBlocked[];
  skipped_sent?: FarmOutNoticeSkipped[];
}

export interface FarmOutReportRow {
  date: string;
  tour: string;
  order_number: string;
  ota_conf_number: string;
  guest: string;
  adults: number;
  children: number;
  partner: string;
  handled_by: string;
  guest_paid: number | null;
  payable: number | null;
  difference: number | null;
  payable_changed_by?: string | null;
  payable_changed_at?: string | null;
  /** "gone_after_farm_out"：转单后订单在 Rezdy 已取消 / 改走（后端 97）。 */
  status?: "ok" | "gone_after_farm_out";
}

export interface FarmOutReport {
  from?: string;
  to?: string;
  partner_id?: number | null;
  rows: FarmOutReportRow[];
}

/** 查单（订单搜索 / 详情 / Tour Tracking / Dispatch 名单）命中转单订单时多的一段。不含合作公司名（任务包第 17 条）。 */
export interface FarmOutView {
  partner_pickup: {
    hotel: string;
    checkin_time: string | null;
    depart_time: string | null;
  };
  /** 后端按「通知发出起 → 发车后 1 小时」算好，前端只管显示。 */
  lead_with: "ours" | "partner";
  notice_sent_at: string | null;
  notice_sent_by: string | null;
}
