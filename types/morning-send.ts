/** 早班发送方式；旧页面默认 SMS Only。 */
export type MorningSendType = "combined" | "sms" | "email";

/** POST /api/notifications/morning-pickup/preview 的一行（只列本页用到的字段）。 */
export interface MorningManifestRow {
  order_number: string;
  name: string;
  phone: string;
  email: string;
  pickup_time: string;
  pickup_location: string;
  driver: string;
  vehicle_no: string;
  /** 今天（洛杉矶）已经发过早班提醒。 */
  duplicate: boolean;
  /** 最早那次是谁发的、什么时候（带时区的 ISO）；没发过为空字符串。 */
  sent_by: string;
  sent_at: string;
  /**
   * 今天发过、但最近那次一个渠道失败、另一个发出去了（后端 2026-10-06，send_guard.summarize_morning_rows）；
   * 否则 null。两个渠道都失败的不算发过（duplicate=false，留在上面那块）。
   */
  partial?: MorningPartial | null;
  /** 只有 Rezdy CSV 的行有：括号外数出来的人数，算不出时 pax_ok=false（.xlsx 的行没有这两个字段）。 */
  pax?: number;
  pax_ok?: boolean;
}

export interface MorningPartial {
  failed: "sms" | "email";
  /** 另一个渠道的状态：有回执写 delivered，否则 sent。 */
  other: "delivered" | "sent";
}

export interface MorningPreview {
  total: number;
  rows: MorningManifestRow[];
  /** 预览那一刻的服务器时间，发送时原样带回：Send anyway 只认这一刻之前发出去的单（后端 2026-10-06）。 */
  preview_at?: string;
}

/** POST /send/morning-pickup 结果里的一行；文件里每一行都有，没选中的 skipped=true。 */
export interface MorningSendResult {
  order: string;
  name: string;
  phone: string;
  pickup_time: string;
  /** "sent:<sid>" / "failed: <原因>" / ""（没发这条渠道）。 */
  sms_status: string;
  /** "sent" / "failed: <原因>" / ""（没发这条渠道或客人没有邮箱）。 */
  email_status: string;
  skipped: boolean;
  /**
   * 服务端跳过的原因（后端 2026-10-06）："already_sent"（今天发过、又没勾 Send anyway）/
   * "listed_twice"（文件里同一单第二行）；没选中的行是 ""。
   */
  reason?: string;
  /** 给 staff 看的原因，例 "Already sent today"、"Listed twice in this file"。 */
  message?: string;
}

export interface MorningSendResponse {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: MorningSendResult[];
}

// type 而不是 interface：要能直接交给 MessagePreviewPanel（Record<string, string>）。
export type MorningMessagePreview = {
  sms: string;
  guest_page: string;
};
