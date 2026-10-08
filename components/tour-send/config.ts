import { isCsvRow } from "@/components/tickets-send/config";
import type { SendTheme } from "@/components/tickets-send/legacy-ui";
import type { PreviewTab } from "@/components/ui/message-preview-panel";
import type {
  TourGuest,
  TourLane,
  TourManifestRow,
  TourTypeOption,
} from "@/types";

export {
  blockReasons,
  isCsvRow,
  SEND_TYPES,
  sendTypeShort,
} from "@/components/tickets-send/config";

export const MESSAGE_PREVIEW_TABS: readonly PreviewTab[] = [
  { key: "sms", label: "📱 SMS", kind: "text" },
  { key: "email", label: "📧 Email", kind: "html" },
  { key: "guest_page", label: "🖥️ Guest Page", kind: "html" },
];

/** 两块各自的文案和颜色（同旧页面：Regular 绿、Last Minute 棕）。 */
export const LANES: Record<
  TourLane,
  {
    title: string;
    /** 预览头、按钮上的名字。 */
    sendLabel: string;
    applyLane: "regular" | "last_minute";
    /** 按钮、预览头的颜色（legacy-ui 的 THEME）。 */
    theme: SendTheme;
  }
> = {
  tour_confirmation: {
    title: "General Order Confirmation",
    sendLabel: "Send to All",
    applyLane: "regular",
    theme: "green",
  },
  last_minute: {
    title: "⚡ Last Minute Order",
    sendLabel: "Send Last Minute",
    applyLane: "last_minute",
    theme: "brown",
  },
};

/**
 * 文件名应含团名片段（接口的 file_slug，例 west）和所选日期（同旧页面 checkFilename）。
 * 不符只提醒，可以照样上传。
 */
export function filenameProblems(
  filename: string,
  option: TourTypeOption | undefined,
  tourDate: string,
): { slug: boolean; date: boolean } {
  const name = filename.toLowerCase();
  return {
    slug: !option?.file_slug || !name.includes(option.file_slug.toLowerCase()),
    date: !name.includes(tourDate),
  };
}

/** MTLV 列：ELIGIBLE ⇒ Eligible；张数 > 0 ⇒ 🎫 N；其余空（同旧页面 mtlvCell）。 */
export function mtlvLabel(raw: TourManifestRow["mtlv_promo"]): string {
  const text = String(raw ?? "").trim();
  if (text.toUpperCase() === "ELIGIBLE") return "Eligible";
  const n = parseInt(text, 10);
  return !Number.isNaN(n) && n > 0 ? `🎫 ${n}` : "";
}

/** 预览里的人数：CSV 算出的人数（算不出 ?），.xlsx 原值。 */
export function paxText(row: TourManifestRow): string {
  if (!isCsvRow(row)) return String(row.quantities ?? "");
  return row.pax_ok ? String(row.pax) : "?";
}

/**
 * 预览行 → 发给后端的一位客人。发送（两块）和 Apply 共用这一份（同旧页面 toGuest）。
 * CSV 送 Quantities 原文（服务端算人数、算不出整批拦），不能当 1（Annie 2026-10-02）；.xlsx 缺省 1。
 */
export function toGuest(row: TourManifestRow): TourGuest {
  const parts = (row.name || "").split(" ");
  const mtlv = parseInt(String(row.mtlv_promo ?? ""), 10);
  return {
    order_number: row.order_number,
    first_name: row.first_name || parts[0] || "",
    last_name: row.last_name || parts.slice(1).join(" ") || "",
    customer_email: row.email || "",
    phone: row.phone || "",
    quantities: isCsvRow(row) ? row.quantities : row.quantities || 1,
    pickup_time: row.pickup_time || "",
    pickup_location: row.pickup_location || "",
    mtlv_promo: row.mtlv_promo == null ? "" : String(row.mtlv_promo),
    mtlv_qty: mtlv > 0 ? mtlv : null,
    upload_row: row.upload_row ?? null,
  };
}

export type StatusTone = "sent" | "failed" | "no-address" | "none";

/**
 * 一条渠道的发送结果（后端原值）→ 显示。旧页面把原值照抄（例 sent:SM…），这里写成人话。
 * "" = 没选这条渠道。
 */
export function channelStatus(raw: string): { tone: StatusTone; text: string } {
  const s = (raw || "").trim();
  if (!s) return { tone: "none", text: "—" };
  if (s.startsWith("sent")) return { tone: "sent", text: "Sent" };
  if (s === "skipped - no email")
    return { tone: "no-address", text: "No email" };
  if (s === "skipped - no phone")
    return { tone: "no-address", text: "No phone" };
  if (s.startsWith("failed")) {
    const why = s.replace(/^failed:?\s*/, "");
    return { tone: "failed", text: why ? `Failed: ${why}` : "Failed" };
  }
  return { tone: "failed", text: s };
}

/** 发出去了 = 至少一条渠道 sent（同旧页面 renderTourResults）。 */
export function isResultSent(r: {
  email_status: string;
  sms_status: string;
}): boolean {
  return (
    (r.email_status || "").startsWith("sent") ||
    (r.sms_status || "").startsWith("sent")
  );
}

/** 没发出去，而且没有哪条渠道真的失败——只是没邮箱 / 没手机号（结果页单独算，不算 Failed）。 */
export function isResultNoAddress(r: {
  email_status: string;
  sms_status: string;
}): boolean {
  if (isResultSent(r)) return false;
  const tones = [
    channelStatus(r.email_status),
    channelStatus(r.sms_status),
  ].map((c) => c.tone);
  return tones.includes("no-address") && !tones.includes("failed");
}
