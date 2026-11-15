/**
 * 145 Phone AI Calls（后端 G178 ③，f4 定稿 2026-11-15）：电话 AI 每次调我们接口的记录，只给 superadmin，留 30 天。
 * GET /api/voice/call-log 和 POST /api/voice/call-log/search 返回一样的形状。
 */

export type VoiceCallEndpoint =
  "lookup" | "lookup-by-order" | "message" | "complaint";

export interface VoiceCallResult {
  order_number: string;
  /** YYYY-MM-DD。 */
  tour_date: string;
  /** 当时告诉 AI 的原值（转单时是合作公司的值）；v167 之前的旧行没有这两个键。 */
  pickup_time?: string | null;
  pickup_location?: string | null;
}

export interface VoiceCall {
  id: number;
  /** UTC ISO。 */
  called_at: string;
  /** 洛杉矶时间，例 "2026-11-14 03:11:00 PM"。 */
  called_at_la: string;
  endpoint: VoiceCallEndpoint | string;
  /** 平台传来的原文（≤32 字）；旧行 / 422 取不到时 null。 */
  phone: string | null;
  phone_last4: string | null;
  /** 200 / 400 / 422 / 503（401 不记）。 */
  status_code: number;
  found_count: number | null;
  action: string | null;
  /** AI 填的原文（≤50 字）。 */
  request_order: string | null;
  /** 整数毫秒；旧行 null。 */
  duration_ms?: number | null;
  results: VoiceCallResult[];
}

export interface VoiceCallLog {
  /** 这次返回的条数（不是总数）；等于 limit 时可能还有更多。 */
  count: number;
  calls: VoiceCall[];
}
