import type { SendLogModule, SendLogRow } from "@/types";

const LA_TIME_ZONE = "America/Los_Angeles";

export const MODULES: readonly SendLogModule[] = [
  "tour_confirmation",
  "morning_pickup",
  "tickets_reminder",
];

interface ModuleStyle {
  /** 表格里的模块标签（与旧页面一致，带色点）。 */
  label: string;
  /** 统计卡片上的名字（与旧页面一致）。 */
  cardLabel: string;
  /** 筛选条 Module 下拉的选项（与旧页面一致）。 */
  optionLabel: string;
  badgeClass: string;
}

/** 与旧页面一致：Tour 绿 / Morning 蓝 / Tickets 橙（.mod-tour / .mod-morning / .mod-tickets）。 */
export const MODULE_STYLES: Record<SendLogModule, ModuleStyle> = {
  tour_confirmation: {
    label: "🟢 Tour Conf",
    cardLabel: "Tour Conf",
    optionLabel: "🟢 Tour Confirmation",
    badgeClass: "bg-[#EAF3DE] text-[#3B6D11]",
  },
  morning_pickup: {
    label: "🔵 Morning P/U",
    cardLabel: "Morning P/U",
    optionLabel: "🔵 Morning Pickup",
    badgeClass: "bg-[#E6F1FB] text-[#185FA5]",
  },
  tickets_reminder: {
    label: "🟠 Tickets",
    cardLabel: "Tickets",
    optionLabel: "🟠 Tickets Reminder",
    badgeClass: "bg-[#FAEEDA] text-[#BA7517]",
  },
};

export function isKnownModule(value: string | null): value is SendLogModule {
  return !!value && value in MODULE_STYLES;
}

export const STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "undelivered", label: "Undelivered" },
] as const;

// ── 日期（一律按洛杉矶） ─────────────────────────────────────────────────────

export { laToday, shiftYmd } from "@/lib/la-date";

const SENT_AT_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** 例如 "9/30/2026, 1:05 PM"（洛杉矶时间）。 */
export function formatSentAt(iso: string | null): string {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(time) ? "—" : SENT_AT_FORMAT.format(time);
}

export function fullName(row: SendLogRow): string {
  return [row.first_name, row.last_name].filter(Boolean).join(" ");
}

// ── 状态胶囊 ──────────────────────────────────────────────────────────────────

export type StatusTone = "ok" | "sent" | "fail" | "pending";

export interface StatusPill {
  label: string;
  tone: StatusTone;
}

/**
 * 邮件一列：值是我们自己写的枚举，用精确等于（Postmark 回调会改写成 delivered / bounce / spam）；
 * 发送失败写的是 "failed" 或 "failed: <原因>"，所以 sent / failed 用 startsWith。
 */
export function emailStatus(status: string | null): StatusPill | null {
  if (!status) return null;
  if (status === "delivered") return { label: "Delivered", tone: "ok" };
  if (status === "bounce") return { label: "Bounced", tone: "fail" };
  if (status === "spam") return { label: "Spam", tone: "fail" };
  if (status.startsWith("sent")) return { label: "Sent", tone: "ok" };
  if (status.startsWith("failed")) return { label: "Failed", tone: "fail" };
  return { label: status, tone: "pending" };
}

/**
 * 短信一列：Twilio 的值可能带前缀，用 includes。
 * ⚠️ 必须先判 undelivered：它包含 "delivered"，顺序反了会显示成绿色的 Delivered。
 */
export function smsStatus(status: string | null): StatusPill | null {
  if (!status) return null;
  if (status.includes("undelivered"))
    return { label: "Undelivered", tone: "fail" };
  if (status.includes("delivered")) return { label: "Delivered", tone: "ok" };
  if (status.includes("sent")) return { label: "Sent", tone: "sent" };
  if (status.includes("failed")) return { label: "Failed", tone: "fail" };
  return { label: status, tone: "pending" };
}

/** 旧页面 .sp-ok / .sp-sent / .sp-fail / .sp-pend。 */
export const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-[#EAF3DE] text-[#3B6D11]",
  sent: "bg-[#EEEDFE] text-[#534AB7]",
  fail: "bg-[#FCEBEB] text-[#A32D2D]",
  pending: "bg-[#E6F1FB] text-[#185FA5]",
};

/** 错误区「Channel」一列：哪条渠道失败了。 */
export function failedChannels(row: SendLogRow): string {
  const channels: string[] = [];
  if (emailStatus(row.email_status)?.tone === "fail") channels.push("📧 Email");
  if (smsStatus(row.sms_status)?.tone === "fail") channels.push("📱 SMS");
  return channels.join(", ") || "—";
}
