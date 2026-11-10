import type { PreviewTab } from "@/components/ui/message-preview-panel";
import type { MorningManifestRow, MorningSendType } from "@/types";

/** 早班没有邮件模板预览（旧页面也只有这两个）。 */
export const MESSAGE_PREVIEW_TABS: readonly PreviewTab[] = [
  { key: "sms", label: "📱 SMS", kind: "text" },
  { key: "guest_page", label: "🖥️ Guest Page", kind: "html" },
];

/**
 * 早班接客提醒一律 SMS + Email，页面上不给选（置顶 106，Annie 2026-11-09「前后端都写死，mornning发送就是sms+email」「动手」）。
 * 值定义在 lib/morning-send-api.ts（发送接口只会带它）；结果表的文字照旧按 send_type 写。
 */
export { MORNING_SEND_TYPE } from "@/lib/morning-send-api";

const SEND_TYPE_SHORT: Record<MorningSendType, string> = {
  combined: "SMS + Email",
  sms: "SMS Only",
  email: "Email Only",
};

export function sendTypeShort(value: MorningSendType): string {
  return SEND_TYPE_SHORT[value] ?? value;
}

export interface LocationGroup {
  location: string;
  rows: MorningManifestRow[];
}

/** 按上车地点分组，组的顺序 = 在文件里第一次出现的顺序（与旧页面一致）。 */
export function groupByLocation(
  rows: readonly MorningManifestRow[],
): LocationGroup[] {
  const groups = new Map<string, MorningManifestRow[]>();
  for (const row of rows) {
    const location = row.pickup_location || "Unknown";
    const list = groups.get(location);
    if (list) list.push(row);
    else groups.set(location, [row]);
  }
  return [...groups].map(([location, list]) => ({ location, rows: list }));
}

const LA_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

/** ISO → "3:54 AM"（洛杉矶）；坏值返回空字符串，不显示 "Invalid Date"。 */
export function formatLaClock(iso: string): string {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(time) ? "" : LA_CLOCK.format(time);
}

/** 「今天已经发过」那一块的抬头：最早几点、谁发的。 */
export function describeAlreadySent(
  rows: readonly MorningManifestRow[],
): string {
  const first = rows
    .map((r) => r.sent_at)
    .filter(Boolean)
    .sort()[0];
  const who = [...new Set(rows.map((r) => r.sent_by).filter(Boolean))];
  const bits: string[] = [];
  if (first) bits.push(formatLaClock(first));
  if (who.length) bits.push(`by ${who.join(", ")}`);
  bits.push("not included in Send");
  return bits.join(" · ");
}

export type ChannelStatus = { label: string; tone: "sent" | "failed" | "none" };

/**
 * 后端写的原值：短信 "sent:<sid>" / "failed: <原因>"，邮件 "sent" / "failed: <原因>"，没发是空字符串。
 * 用 startsWith，不用 includes：失败原因里可能带 "sent" 这个词。
 */
export function channelStatus(raw: string): ChannelStatus {
  if (raw.startsWith("sent")) return { label: "Sent", tone: "sent" };
  if (raw.startsWith("failed")) {
    const reason = raw.slice("failed".length).replace(/^:\s*/, "");
    return { label: reason ? `Failed: ${reason}` : "Failed", tone: "failed" };
  }
  return { label: raw || "—", tone: "none" };
}
