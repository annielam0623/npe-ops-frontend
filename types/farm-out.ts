/**
 * Farm out（转单，G40，任务包 docs/farm-out/任务包_farm-out.md，2026-10-10 定稿）。
 * 这一轮只接 mock（后端还没做阶段一），先出预览给 Annie 看，接口形状按任务包和两轮旧预览（Annie 已逐条批过）定。
 */

/** Settings → Farm out Partners：合作公司名单 + 按团的结算价。 */
export interface FarmOutPartner {
  id: number;
  name: string;
  is_active: boolean;
  rates: FarmOutPartnerRate[];
}

export interface FarmOutPartnerRate {
  manifest_id: number;
  tour_name: string;
  /** null = 没设（那个团还不能转给这家公司）。 */
  adult_rate: number | null;
  child_rate: number | null;
}

/** Settings → Farm out Timetable：每家公司自己的一套上车点（不配我们的酒店）+ 发车时刻表。 */
export interface FarmOutPickupSpot {
  id: number;
  partner_id: number;
  name: string;
  address: string;
  map_link: string;
  /** manifest_id → 发车时间 "H:MM AM/PM"；没有这个键 = 这个团这家公司这个点没有时刻、不能转单。 */
  departures: Record<number, string>;
}

/** 按团、所有公司共用：预计返回时间、PLEASE NOTE（Settings → Farm out Timetable 表格下面）。 */
export interface FarmOutTourMeta {
  manifest_id: number;
  tour_name: string;
  /** null = 没设，通知里这一项留空。 */
  return_time: string | null;
  /** 空字符串 = 没设，通知里整段 PLEASE NOTE 不显示。 */
  please_note: string;
}

export interface FarmOutTimetable {
  partners: { id: number; name: string }[];
  tours: { manifest_id: number; tour_name: string }[];
  spots: FarmOutPickupSpot[];
  tour_meta: FarmOutTourMeta[];
}

/** 上传 CSV / xlsx 解析出的 diff（Apply 前先看）。 */
export interface FarmOutTimetableUploadDiff {
  file_name: string;
  /** 时间变了的格子。 */
  changed: { spot_name: string; manifest_id: number; tour_name: string; before: string | null; after: string }[];
  /** 文件里有、现在没有的上车点（会新建）。 */
  new_spots: { name: string; departures: Record<string, string> }[];
  /** 文件表头里对不上任何 tours 的列名（整列忽略）。 */
  unknown_tours: string[];
  /** 解析完、还没 Apply 的整张表（spot 名 → manifest_id → 时间），Apply 时原样送回。 */
  parsed: { spot_name: string; departures: Record<number, string> }[];
}

/** Dispatch Step 2：第二台车设成 Farm out 后，这台车本身只需要这些（不要司机/车号/导游/酒店）。 */
export interface FarmOutCar {
  /** 对应 DispatchRow.id；新加的车是 null。 */
  row_id: number | null;
  partner_id: number | null;
}

/** Farm out 车下面，一张订单的转单明细（覆盖 Seat guests 的那张订单）。 */
export interface FarmOutOrderDetail {
  order_number: string;
  manifest_id: number;
  run_date: string;
  /** OTA（Viator / GetYourGuide 等）确认号；没有就用我们的订单号（任务包第 10 条）。 */
  confirmation: string;
  adults: number;
  children: number;
  /** 婴儿不计价，只是显示。 */
  infants: number;
  /** 这家公司的上车点；null = 还没选（不能发通知）。 */
  pickup_spot_id: number | null;
  /** 自动算出的（spot 的 departures[manifest_id] − 10 分钟）；staff 改过就是改后的。 */
  checkin_time: string | null;
  depart_time: string | null;
  /** staff 是否手动改过时间（跟时刻表自动算的不一样）。 */
  time_edited: boolean;
  /** 自动算：成人数 × adult_rate + 儿童数 × child_rate；staff 可改。 */
  payable: number;
  payable_auto: number;
  payable_edited_by: string | null;
  payable_edited_at: string | null;
  notice_sent_at: string | null;
  notice_sent_by: string | null;
}

/** Dispatch 页：一个团当天 Farm out 相关的状态（和现有 Step 2 的车/订单数据拼在一起用）。 */
export interface FarmOutTourState {
  manifest_id: number;
  /** 这个团在时刻表里有没有设过任何上车点 + 时间（任务包第 9 条：没有就不能转单）。 */
  has_timetable: boolean;
  orders: FarmOutOrderDetail[];
}

export interface FarmOutDay {
  run_date: string;
  partners: { id: number; name: string }[];
  tours: FarmOutTourState[];
}

/** 发转单通知：先查一遍名单（已发过的标出来），同一套发送统一格式（components/tickets-send/legacy-ui）。 */
export interface FarmOutSendRow {
  order_number: string;
  chd_number: string;
  confirmation: string;
  name: string;
  phone: string | null;
  email: string | null;
  pickup_spot_name: string | null;
  checkin_time: string | null;
  depart_time: string | null;
  already_sent: { by: string; at: string } | null;
  /** true = 这单还没选上车点，不能发（灰勾，Send anyway 也不行）。 */
  missing_pickup_spot: boolean;
}

export interface FarmOutSendPreview {
  manifest_id: number;
  tour_name: string;
  run_date: string;
  rows: FarmOutSendRow[];
  /** 第一单的通知原文（Email + SMS），右边栏预览用。 */
  sample_email_subject: string;
  sample_email_body: string;
  sample_sms: string;
}

export interface FarmOutSendRowResult {
  order_number: string;
  chd_number: string;
  name: string;
  email_status: "sent" | "failed" | "skipped";
  email_error?: string;
  sms_status: "sent" | "failed" | "skipped";
  sms_error?: string;
}

export interface FarmOutSendResult {
  sent: number;
  failed: number;
  total: number;
  rows: FarmOutSendRowResult[];
}

/** 转单报表。 */
export interface FarmOutReportRow {
  run_date: string;
  tour_name: string;
  order_number: string;
  confirmation: string;
  guest_name: string;
  adults: number;
  children: number;
  partner_name: string;
  handled_by: string;
  guest_paid: number;
  payable: number;
  /** guest_paid − payable。 */
  difference: number;
  payable_edited: boolean;
  payable_edited_by: string | null;
  payable_edited_at: string | null;
}

export interface FarmOutReport {
  rows: FarmOutReportRow[];
  partners: { id: number; name: string }[];
}
