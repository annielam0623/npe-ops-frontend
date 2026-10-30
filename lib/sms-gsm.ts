/**
 * 短信的 GSM-7 字符集（一条短信 160 个 GSM 字符；出现一个非 GSM 字符，整条按 Unicode 算，只剩 70 个字、费用翻倍）。
 * Send to guide 的「链接后面加一句」用（Annie 2026-10-30「限制在一条短信的长度」）：页面上实时算还剩几个字、挡住非 GSM 字符。
 * 后端也会再查一次（超长 / 非法字符 400 原话）。
 * ⚠️ 两张表照后端 `app/services/gsm7.py`（_GSM_BASIC / _GSM_EXTENDED，项目里唯一的真源）逐字抄的，改那边要跟着改这里：
 * 判定和计数用的表不一样，会出现「页面说能发、后端说超长」。
 */

const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** 扩展字符：各占 2 个位置。 */
const EXTENDED = "^{}\\[~]|€";

const basic = new Set(BASIC);
const extended = new Set(EXTENDED);

/** 这段字里不是 GSM-7 的字符（去重，按出现顺序）。 */
export function nonGsmChars(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (!basic.has(ch) && !extended.has(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/** 按 GSM-7 算占几个位置（扩展字符算 2）；非 GSM 字符按 1 算（另外由 nonGsmChars 挡住）。 */
export function gsmLength(text: string): number {
  let n = 0;
  for (const ch of text) n += extended.has(ch) ? 2 : 1;
  return n;
}
