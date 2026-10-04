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
  page: number;
}
