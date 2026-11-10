import { isCsvRow } from "@/components/tickets-send/config";
import type { SendTheme } from "@/components/tickets-send/legacy-ui";
import type { PreviewTab } from "@/components/ui/message-preview-panel";
import { legacyChannel, resolveOutcome } from "@/lib/send-outcome";
import type {
  TicketsSendType,
  TourGuest,
  TourLane,
  TourManifestRow,
  TourSendResult,
  TourTypeOption,
} from "@/types";

export {
  blockReasons,
  hasBadPax,
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

/** 这次发送有没有用到这个渠道。 */
export function usesChannel(
  sendType: TicketsSendType,
  channel: "sms" | "email",
): boolean {
  return sendType === "combined" || sendType === channel;
}

/**
 * 一行结果的结论（置顶 109）：后端带 outcome / *_outcome 就用；旧后端按状态原文换算
 * （"sent…" / "failed: …" / "skipped - no email|phone" / "" = 没选这个渠道）。
 */
export function tourRowOutcome(r: TourSendResult, sendType: TicketsSendType) {
  return resolveOutcome(r, {
    sms: legacyChannel(r.sms_status, usesChannel(sendType, "sms")),
    email: legacyChannel(r.email_status, usesChannel(sendType, "email")),
  });
}
