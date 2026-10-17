/**
 * Farm out（转单，G40）——后端草稿 `docs/interfaces/farm-out-2026-10-16.md`（npe-confirmation-service 仓库 53cbc7b）。
 * ⚠️ 后端还没写代码，字段名随 Annie 审阅可能调；后端定稿后回来核对。所有新字段都是可选，后端没上线时页面和现在一样。
 */

/** 一张订单当前坐在 Farm out 车上时才有（seating 订单里的 `farm_out`）。时间 "HH:MM" 24 小时制。 */
export interface FarmOutOrder {
  partner_id: number;
  partner_location_id: number | null;
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
  hotels: { id: number; hotel_name: string; spot: string }[];
  tours: { manifest_id: number; tour_name: string }[];
  /** key = `<hotel_id>_<manifest_id>`，值 "HH:MM"（发车时间）。 */
  cells: Record<string, string>;
}

export interface FarmOutTimetableDiff {
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
  /** 这单缺什么（没选酒店 / 没有结算价…）；非空就不能发。 */
  missing: string[];
}

export interface FarmOutNoticeResult {
  order_number: string;
  name: string;
  email_status: string;
  sms_status: string;
}

export interface FarmOutNoticeSendResponse {
  total: number;
  sent: number;
  failed: number;
  results: FarmOutNoticeResult[];
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
