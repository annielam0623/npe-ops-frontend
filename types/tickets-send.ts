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
  /** 同一单在文件里第二次出现、内容和第一行一样：不发（客人只收一条）。 */
  listed_twice?: boolean;
  /** 同一单在文件里出现不止一次、内容不一样：整批不能发。 */
  listed_twice_conflict?: boolean;
  /** 只有 Rezdy CSV 的行有：算出的人数、算不算得出、Quantities 原文。算不出 ⇒ 整批不能发。 */
  pax?: number;
  pax_ok?: boolean;
  qty_label?: string;
  /** CSV 的整行原表，发送时原样带回（后端存起来）。 */
  upload_row?: unknown;
  /** 这个团期已有订单时（重新上传）：这一单是新加的 / 变了 / 没变。 */
  upload_status?: "added" | "changed" | "unchanged";
  /** 变了的列：旧值 → 新值。 */
  changes?: { col: string; old: string; new: string }[];
}

/** 系统里有、这次文件里没有的单（只标出来，不发消息）。 */
export interface TicketsRemovedOrder {
  order_number: string;
  name: string;
  pax: number | string | null;
  checkin_time: string;
  tour_time: string;
}

/**
 * check-duplicates 的返回。Excel 解析失败时后端返回 200 + error（不是 4xx），rows 为空。
 */
export interface TicketsDuplicateCheck {
  error?: string;
  duplicates: string[];
  total: number;
  rows: TicketsManifestRow[];
  /** 文件里同一单出现两次、内容不一样的订单号。 */
  listed_twice_conflicts?: string[];
  /** 预览时的服务器时间：发送时原样带回，勾了 Send anyway 的单只有在这之前发过的才会再发一次。 */
  preview_at?: string;
  /** CSV 编码是猜的时候的提示。 */
  warning?: string;
  /** Check-in Time 是按 Content Studio 的分钟数算出来的时候的说明（后端 37f4020）；空串 = 文件自带。 */
  checkin_note?: string;
  /** 重新上传的比对：reupload=false 表示这个团期还没有订单，不显示比对。 */
  compare?: {
    reupload: boolean;
    removed: TicketsRemovedOrder[];
    counts: Record<string, number>;
  };
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
  /** CSV 送 Quantities 原文（服务端算人数、算不出整批拦）；.xlsx 送数字。 */
  no_of_pax: string | number;
  upload_row?: unknown;
}

export interface TicketsSendResult {
  record_id: number;
  sms_ok: boolean;
  /** 成功时后端返回 {message_id} 对象，失败为 false——按真假判断。 */
  email_ok: unknown;
  name: string;
  chd_number: string;
}

/** 服务端发之前再查一次重，跳过的客人。 */
export interface TicketsSkipped {
  chd_number: string;
  name: string;
  reason?: "already_sent" | "listed_twice" | string;
  message: string;
}

export interface TicketsSendBulkResponse {
  sent: number;
  results: TicketsSendResult[];
  skipped?: TicketsSkipped[];
}

// type 而不是 interface：要能直接交给 MessagePreviewPanel（Record<string, string>）。
export type TicketsMessagePreview = {
  sms: string;
  email: string;
  guest_page: string;
};
