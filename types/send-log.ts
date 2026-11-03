import type { SendBatchSummary } from "./send-batches";

/** send_log.module 目前的三个值；库里是自由字符串，不认识的按原值显示。 */
export type SendLogModule =
  "tour_confirmation" | "morning_pickup" | "tickets_reminder";

/** GET /api/notifications/send-log 的一行。空值可能是 null。 */
export interface SendLogRow {
  /** 带时区的 ISO 时刻。 */
  sent_at: string | null;
  module: string | null;
  order_number: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  /** YYYY-MM-DD，没有时为空字符串。 */
  tour_date: string;
  tour_type: string | null;
  /** sent / delivered / bounce / spam / failed / "failed: <原因>" 等。 */
  email_status: string | null;
  /** Twilio 的值：sent / delivered / undelivered / failed 等，可能带前缀。 */
  sms_status: string | null;
  error_msg: string | null;
  sent_by: string | null;
  /** 发送时记下的 MTLV 资格（send_log.mtlv_eligible，空值算 false）。 */
  mtlv_eligible: boolean;
}

export interface SendLogPage {
  /** 符合筛选条件的总行数（分页用）。 */
  total: number;
  page: number;
  /** 按当前筛选条件统计；模块筛选也算在内。 */
  stats: {
    total: number;
    tour_confirmation: number;
    morning_pickup: number;
    tickets_reminder: number;
    /** 当前筛选下、所有模块里 MTLV 的行数。 */
    mtlv: number;
  };
  rows: SendLogRow[];
}

export type SendLogChannel = "EMAIL" | "SMS";

export interface SendLogQuery {
  /** 洛杉矶日期 YYYY-MM-DD，两端都含当天。 */
  from: string;
  to: string;
  module: SendLogModule | "";
  channel: SendLogChannel | "";
  /** 后端按 ILIKE %status% 匹配邮件或短信状态。 */
  status: string;
  /** 只看 MTLV 的行。 */
  mtlv: boolean;
  /** 按订单号「包含」搜；有值时不限日期。 */
  orderNumber: string;
  page: number;
}

/** G230：Send Log 整页按组，一次发送一组（GET /api/notifications/send-log/groups 的一组）。 */
export interface SendLogGroup {
  /** 补批次已跑完，生产上都有值；万一为 null 就没有明细可点。 */
  batch_id: number | null;
  module: string;
  tour_type: string;
  /** 后端写好的名字：团名（Last Minute 带后缀）、Morning Pickup / Guest reply / Broadcast / Farm-out notice。 */
  tour_label: string;
  tour_date: string;
  send_type: string;
  sent_by: string;
  started_at: string;
  /** 洛杉矶时间，已格式化："Oct 3, 2026 11:52 PM"。 */
  started_at_label: string;
  /** 整组的数字，不受筛选影响。 */
  summary: SendBatchSummary;
  /** 这一组里符合当前筛选的行数。 */
  matched_rows: number;
  matched_orders: string[];
}

export interface SendLogGroupsPage {
  /** 符合筛选的行数。 */
  total: number;
  /** 符合筛选的组数（分页用）。 */
  total_groups: number;
  page: number;
  page_size: number;
  stats: SendLogPage["stats"];
  groups: SendLogGroup[];
}

/** GET …/send-log/groups/{batch_id}/rows 的一行：逐条的形状 + id + 是否符合当前筛选。 */
export interface SendLogGroupRow extends SendLogRow {
  id: number;
  batch_id: number | null;
  matched: boolean;
}
