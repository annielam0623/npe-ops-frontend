/**
 * Test send 页（Annie 2026-11-18「1A 2A 3A 4A 5A，How to use 照用，动手」；后端 8e a88e43f6 app/routers/test_send.py）。
 */

export type TestSendChannel = "sms" | "email";

export interface TestSendModule {
  /** tour_confirmation / last_minute / shuttle / tickets_reminder / morning_pickup / farm_out / broadcast */
  key: string;
  label: string;
  /** "Tour type" / "Product" / "Partner" / "Template"；"" ⇒ 这个模块没有第二个下拉（Morning Pickup）。 */
  choice_label: string;
  choices: { value: string; label: string }[];
  date_label: string;
  /** 能发的渠道，默认全勾。 */
  channels: TestSendChannel[];
}

/** GET /api/test-send/options */
export interface TestSendOptions {
  /** 登录人；phone 来自 HR 档案，没有就 ""。 */
  recipient: { name: string; phone: string; email: string };
  modules: TestSendModule[];
}

/** POST /api/test-send/preview 的 body；send 再加 phone / email / channels。 */
export interface TestSendTarget {
  module: string;
  choice: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface TestSendPreview {
  sms: string | null;
  email_subject: string | null;
  email_html: string | null;
  sample_note: string;
}

/** 一个渠道的结果；null = 这次没勾。 */
export type TestSendChannelResult = { ok: true } | { ok: false; error: string };

export interface TestSendResult {
  sms: TestSendChannelResult | null;
  email: TestSendChannelResult | null;
}
