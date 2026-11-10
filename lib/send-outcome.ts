/**
 * 发送结果统一判定（置顶 109，Annie 2026-11-09「全 A」「动手」；后端形状 docs/interfaces/send-outcome-2026-11-09.md）。
 * 后端每行带 outcome / sms_outcome / email_outcome 时只看它们；旧后端没带时，各页面把老的状态原文换算成同样的值
 * （见各页面的 legacy 换算），显示和计数都走这一份，所有发送页一个口径。
 */

/** 一个渠道的结果。 */
export type ChannelOutcome =
  "sent" | "failed" | "no_address" | "skipped" | "not_used";

/** 一位客人的结果。 */
export type GuestOutcome = "sent" | "failed" | "no_contact" | "not_sent";

/** 后端每行新加的三个字段（旧后端没有）。 */
export interface OutcomeFields {
  outcome?: GuestOutcome | null;
  sms_outcome?: ChannelOutcome | null;
  email_outcome?: ChannelOutcome | null;
}

const CHANNEL_VALUES = new Set<string>([
  "sent",
  "failed",
  "no_address",
  "skipped",
  "not_used",
]);
const GUEST_VALUES = new Set<string>([
  "sent",
  "failed",
  "no_contact",
  "not_sent",
]);

/** 后端带了合法的渠道结果就用它；没带 / 不认识 = null（用页面自己的旧换算）。 */
export function backendChannel(v: unknown): ChannelOutcome | null {
  return typeof v === "string" && CHANNEL_VALUES.has(v)
    ? (v as ChannelOutcome)
    : null;
}

export function backendGuest(v: unknown): GuestOutcome | null {
  return typeof v === "string" && GUEST_VALUES.has(v)
    ? (v as GuestOutcome)
    : null;
}

/** 后端没带 outcome 时，按两个渠道推出客人结果（判据同后端 send_outcome.py）。 */
export function guestFromChannels(
  sms: ChannelOutcome,
  email: ChannelOutcome,
): GuestOutcome {
  const used = [sms, email].filter((c) => c !== "not_used");
  if (used.includes("sent")) return "sent";
  if (used.includes("failed")) return "failed";
  if (used.length && used.every((c) => c === "no_address")) return "no_contact";
  return "not_sent";
}

/** 一行的最终结论：后端的 outcome 优先，没有就按渠道推。 */
export function resolveOutcome(
  row: OutcomeFields,
  legacy: { sms: ChannelOutcome; email: ChannelOutcome },
): { outcome: GuestOutcome; sms: ChannelOutcome; email: ChannelOutcome } {
  const sms = backendChannel(row.sms_outcome) ?? legacy.sms;
  const email = backendChannel(row.email_outcome) ?? legacy.email;
  return {
    sms,
    email,
    outcome: backendGuest(row.outcome) ?? guestFromChannels(sms, email),
  };
}

/** 结果字颜色（浅色结果卡；Annie：成功绿、失败红；没地址 / 跳过灰）。 */
export const OUTCOME_GREEN = "font-medium text-[#3B6D11]";
export const OUTCOME_RED = "text-[#A32D2D]";
export const OUTCOME_GREY = "text-[#6B6B6B]";
const PLAIN = "text-[#1a1a1a]";

/** 一个渠道在表格里的写法。skipped 带后端原因（例 staff 回复「没有可用的短信渠道」）。 */
export function channelCell(
  channel: "sms" | "email",
  outcome: ChannelOutcome,
  reason?: string,
): { label: string; className: string } {
  switch (outcome) {
    case "sent":
      return { label: "Sent", className: OUTCOME_GREEN };
    case "failed":
      return {
        label: reason ? `Failed: ${reason}` : "Failed",
        className: OUTCOME_RED,
      };
    case "no_address":
      return {
        label: channel === "sms" ? "No number" : "No email",
        className: OUTCOME_GREY,
      };
    case "skipped":
      return {
        label: reason ? `Skipped: ${reason}` : "Skipped",
        className: OUTCOME_GREY,
      };
    case "not_used":
      return { label: "—", className: PLAIN };
  }
}

/** 渠道状态原文里「failed: 原因」的原因（显示用）；不是 failed 开头就空。 */
export function failedReason(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  return /^failed/i.test(s) ? s.replace(/^failed:?\s*/i, "") : "";
}

export interface OutcomeCounts {
  sent: number;
  failed: number;
  no_contact: number;
  not_sent: number;
}

export function countOutcomes(outcomes: Iterable<GuestOutcome>): OutcomeCounts {
  const c: OutcomeCounts = { sent: 0, failed: 0, no_contact: 0, not_sent: 0 };
  for (const o of outcomes) c[o]++;
  return c;
}

/**
 * 汇总格（Sent 绿 / Failed 红 / No contact 灰；Not sent 有才出，灰）。顺序在 Skipped、Total 之前。
 * 给 legacy-ui 的 ResultStat 用。
 */
export function outcomeStats(
  c: OutcomeCounts,
): { label: string; value: number; className: string }[] {
  const out = [
    { label: "Sent", value: c.sent, className: "text-[#3B6D11]" },
    { label: "Failed", value: c.failed, className: "text-[#A32D2D]" },
    { label: "No contact", value: c.no_contact, className: "text-[#6B6B6B]" },
  ];
  if (c.not_sent)
    out.push({
      label: "Not sent",
      value: c.not_sent,
      className: "text-[#6B6B6B]",
    });
  return out;
}

/**
 * 旧后端的渠道状态原文 → 渠道结果（Tour 一族、Farm out、早班 / relay 的 "sent…" / "failed: …" / "skipped - no …" / 空）。
 * used = 这次选没选这个渠道；hasAddress 已知时用来认「没地址也试发、记 failed」的旧行（早班没号码）。
 */
export function legacyChannel(
  raw: string | null | undefined,
  used: boolean,
  hasAddress?: boolean,
): ChannelOutcome {
  if (!used) return "not_used";
  const s = (raw ?? "").trim().toLowerCase();
  if (s.startsWith("sent")) return "sent";
  if (s.startsWith("skipped - no")) return "no_address";
  if (hasAddress === false) return "no_address";
  if (!s) return hasAddress === undefined ? "no_address" : "failed";
  if (s.startsWith("skipped")) return "skipped";
  return "failed";
}

/**
 * 状态原文是「没地址、没试」（后端 W1 / W2 起早班、relay、门票写 "skipped - no phone" / "skipped - no email"）：
 * Tracking / Send Log 这类直接显示原文的地方照 Q1 写灰字 No number / No email，不当失败、不显示原文。
 */
export function noAddressLabel(
  raw: string | null | undefined,
  channel: "sms" | "email",
): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s.startsWith("skipped - no")) return null;
  return channel === "sms" ? "No number" : "No email";
}

/** noAddressLabel 给出的两种字（表格里按字上灰色用）。 */
export function isNoAddressLabel(label: string): boolean {
  return label === "No number" || label === "No email";
}
