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
}

export interface MorningPreview {
  total: number;
  rows: MorningManifestRow[];
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
