/** GET /api/promotion-stats/summary 的返回体。 */
export interface PromotionStatsSummary {
  total_eligible: number;
  selected_qty: number;
  yes_no_ticket: number;
  pending_send: number;
  sent: number;
  cancelled: number;
}

/** GET /api/promotion-stats/detail 的 status 查询参数。 */
export type PromotionDetailStatus =
  "all" | "selected" | "yes_no_ticket" | "pending";

export type PromotionConfirmation = "yes" | "modify_req" | (string & {});

export type MtlvTicketStatus = "pending_send" | "sent" | "cancel" | "—";

export interface PromotionDetailRecord {
  order_number: string;
  first_name: string | null;
  last_name: string | null;
  customer_email: string | null;
  phone: string | null;
  tour_date: string;
  tour_type: string | null;
  quantities: string | null;
  confirmation: PromotionConfirmation | null;
  mtlv_qty: number;
  mtlv_ticket_status: MtlvTicketStatus;
}

/** GET /api/promotion-stats/detail 的返回体，后端最多返回 500 条，按 tour_date DESC, order_number 排序。 */
export type PromotionStatsDetail = PromotionDetailRecord[];

/** 两个接口共用的日期范围参数，YYYY-MM-DD；都不传表示统计全部时间。 */
export interface PromotionDateRange {
  date_from?: string;
  date_to?: string;
}
