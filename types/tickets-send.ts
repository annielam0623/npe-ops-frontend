/** 发送方式：两条都发 / 只发短信 / 只发邮件。 */
export type TicketsSendType = "combined" | "sms" | "email";

/** POST /api/tickets-reminder/check-duplicates 解析出的一行（只列本页用到的字段）。 */
export interface TicketsManifestRow {
  order_number: string;
  confirmation_no: string;
  name: string;
  email: string;
  phone: string;
  /** Excel 里的原值，字符串（缺省 "1"）。 */
  quantities: string;
  checkin_time: string;
  tour_time: string;
  /** 这一天 + 这个产品，这张单已经发过提醒。 */
  duplicate: boolean;
}

/**
 * check-duplicates 的返回。Excel 解析失败时后端返回 200 + error（不是 4xx），rows 为空。
 */
export interface TicketsDuplicateCheck {
  error?: string;
  duplicates: string[];
  total: number;
  rows: TicketsManifestRow[];
}

/** POST /api/tickets-reminder/send-bulk 里的一位客人。 */
export interface TicketsGuest {
  chd_number: string;
  confirmation_no: string;
  first_name: string;
  last_name: string;
  customer_email: string;
  phone: string;
  service_date: string;
  tour_type: string;
  checkin_time: string;
  tour_time: string;
  no_of_pax: string | number;
}

export interface TicketsSendResult {
  record_id: number;
  sms_ok: boolean;
  /** 成功时后端返回 {message_id} 对象，失败为 false——按真假判断。 */
  email_ok: unknown;
  name: string;
  chd_number: string;
}

export interface TicketsSendBulkResponse {
  sent: number;
  results: TicketsSendResult[];
}

// type 而不是 interface：要能直接交给 MessagePreviewPanel（Record<string, string>）。
export type TicketsMessagePreview = {
  sms: string;
  email: string;
  guest_page: string;
};
