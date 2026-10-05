/** Send Log 的「Send batches」：一次点 Send 一批（门票、团确认、Last Minute；后端 send_batches，migrate_v70）。 */
export interface SendBatchSummary {
  /** 文件里有几行。 */
  file_rows: number;
  /** 至少一条渠道发出去的。 */
  sent: number;
  failed: number;
  skipped: number;
  /** 文件里有、但这一批既没有发送记录也没有跳过记录的（断开后剩下的几组）。 */
  not_sent: number;
}

export interface SendBatch {
  id: number;
  module: "tickets_reminder" | "tour_confirmation" | "last_minute" | string;
  tour_type: string;
  /** 已带 (Last Minute) 后缀。 */
  tour_label: string;
  tour_date: string;
  send_type: string;
  sent_by: string;
  /** 洛杉矶时间，已格式化："Oct 3, 2026 11:52 PM"。 */
  started_at: string;
  summary: SendBatchSummary;
}

export type SendBatchDelivery = Record<
  "delivered" | "waiting" | "problem" | "none",
  number
>;

export interface SendBatchDetail extends SendBatch {
  summary: SendBatchSummary & {
    email: SendBatchDelivery;
    sms: SendBatchDelivery;
  };
  rows: {
    order_number: string;
    name: string;
    email: string;
    phone: string;
    sent_at: string;
    went_out: boolean;
    email_status: string;
    email_state: string;
    sms_status: string;
    sms_state: string;
    error_msg: string;
  }[];
  skipped: { order_number: string; name: string; reason: string }[];
}
