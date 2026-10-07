import type { ManifestGroup, ManifestRow } from "@/types";

/** 块的身份：有组号的按组号；没有组号时按「在 Products 里但没归组」/「没进 Products」区分（同后端 group_summary）。 */
export function blockKey(r: {
  group_id: number | null;
  in_products: boolean;
}): string {
  if (r.group_id !== null) return `g:${r.group_id}`;
  return r.in_products ? "ungrouped" : "not-in-products";
}

/** 块标题：有组名用组名；没有组的两种分别叫 No group / Not in Products yet（同 Settings → Products 的叫法）。 */
export function blockTitle(g: ManifestGroup): string {
  if (g.group_id !== null) return g.group_name || "(unnamed group)";
  return g.in_products ? "No group" : "Not in Products yet";
}

/** 按 groups 的顺序（已经是后端排好的显示顺序）把 rows 分到各块。 */
export function rowsByBlock(
  groups: readonly ManifestGroup[],
  rows: readonly ManifestRow[],
): Map<string, ManifestRow[]> {
  const byKey = new Map<string, ManifestRow[]>();
  for (const g of groups) byKey.set(blockKey(g), []);
  for (const r of rows) {
    const k = blockKey(r);
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }
  return byKey;
}

export const STATUS_TONE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-700",
  unknown: "bg-stone-100 text-stone-500",
};

const LA_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

/** ISO → "3:54 AM"（洛杉矶）；坏值 / 空值返回空字符串。 */
export function formatLaClock(iso: string | null): string {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(time) ? "" : LA_CLOCK.format(time);
}

export const LANE_LABEL = {
  tour: "Tour",
  morning: "Morning",
  tickets: "Tickets",
} as const;

export type LaneKey = keyof typeof LANE_LABEL;

/** 一条发送线的提示文字（给胶囊的 title）。 */
export function laneTitle(
  lane: LaneKey,
  info: ManifestRow["sent"][LaneKey] | null,
): string {
  if (!info) return `${LANE_LABEL[lane]}: not sent`;
  const bits = [`${LANE_LABEL[lane]}: sent`];
  if (info.by) bits.push(`by ${info.by}`);
  const clock = formatLaClock(info.at);
  if (clock) bits.push(`at ${clock}`);
  if (lane === "morning" && "partial" in info && info.partial) {
    const otherChannel = info.partial.failed === "sms" ? "email" : "sms";
    bits.push(
      `(${info.partial.failed} failed, ${otherChannel} ${info.partial.other})`,
    );
  }
  return bits.join(" ");
}

/** CSV 行（导出按屏幕上的顺序：块 → 接客时间 → 产品 → 姓）。 */
export function toCsvRow(r: ManifestRow): (string | number)[] {
  return [
    r.order_number,
    `${r.first_name} ${r.last_name}`.trim(),
    r.phone,
    r.email,
    r.group_name || (r.in_products ? "No group" : "Not in Products yet"),
    r.category,
    r.product_label,
    r.pax ?? "",
    r.pickup_time,
    r.pickup_location,
    r.status,
    r.confirmation_no,
    r.agent_name,
    r.sent.tour ? "yes" : "no",
    r.sent.morning ? "yes" : "no",
    r.sent.tickets ? "yes" : "no",
    r.lane_source === "legacy" ? "legacy" : "",
  ];
}

export const CSV_HEADERS = [
  "Order #",
  "Guest",
  "Phone",
  "Email",
  "Group",
  "Category",
  "Product",
  "Pax",
  "Pickup Time",
  "Pickup Location",
  "Status",
  "Confirmation #",
  "Agent",
  "Sent Tour",
  "Sent Morning",
  "Sent Tickets",
  "Legacy Data",
] as const;
