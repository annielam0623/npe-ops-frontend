import type { BroadcastCandidate } from "@/components/ui/broadcast-dialog";
import type { ColumnVisibility } from "@/components/ui/column-picker";
import type { ContactBadge } from "@/components/ui/conversation-modal";
import type { TourTrackingRow, TourTypeOption } from "@/types";

/** 每 60 秒静默重拉整表（同旧页面的轮询间隔）。 */
export const POLL_INTERVAL_MS = 60_000;

// ── 团型（来自 GET /api/notifications/tour-confirmation/tour-types，不写死）──

export interface TourMeta {
  /** 显示顺序。 */
  order: string[];
  abbr: (key: string) => string;
  label: (key: string) => string;
  hasLunch: (key: string) => boolean;
  hasBeef: (key: string) => boolean;
  /** 午餐分组（Antelope / South / BZ / VOF-F），按团型出现的顺序。 */
  lunchGroups: { label: string; types: string[] }[];
}

export function tourMeta(types: TourTypeOption[]): TourMeta {
  const byKey = new Map(types.map((t) => [t.key, t]));
  const groups: { label: string; types: string[] }[] = [];
  for (const t of types) {
    if (!t.lunch_group) continue;
    const g = groups.find((x) => x.label === t.lunch_group);
    if (g) g.types.push(t.key);
    else groups.push({ label: t.lunch_group, types: [t.key] });
  }
  return {
    order: types.map((t) => t.key),
    // 接口里没有的团型（例如后端删了某个团、老数据还在）照实显示代码。
    abbr: (k) => byKey.get(k)?.abbr || k || "—",
    label: (k) => byKey.get(k)?.label || k,
    hasLunch: (k) => !!byKey.get(k)?.has_lunch,
    hasBeef: (k) => !!byKey.get(k)?.has_beef,
    lunchGroups: groups,
  };
}

export interface TourPill {
  key: string;
  label: string;
  replied: number;
  total: number;
}

/**
 * 团型按钮（同旧页面 buildPills）：All + 每个团型（没有单的也列，0/0），数的是单数：回复了的（不是 pending）/ 全部。
 * 这天出现了、接口里却没有的团型补在后面。
 */
export function tourPills(rows: TourTrackingRow[], meta: TourMeta): TourPill[] {
  const extra = [...new Set(rows.map((r) => r.tour_type))].filter(
    (k) => k && !meta.order.includes(k),
  );
  return [...meta.order, ...extra].map((key) => {
    const mine = rows.filter((r) => r.tour_type === key);
    return {
      key,
      label: meta.abbr(key),
      replied: mine.filter((r) => statusOf(r) !== "pending").length,
      total: mine.length,
    };
  });
}

// ── 列 ──────────────────────────────────────────────────────────────────────

export type SystemColumnKey =
  | "order_number"
  | "status"
  | "tour"
  | "tour_date"
  | "guest_name"
  | "phone"
  | "party"
  | "email"
  | "sms"
  | "turkey"
  | "veggie"
  | "beef"
  | "mtlv"
  | "tickets"
  | "notes"
  | "whatsapp"
  | "submitted";

/**
 * 17 列，顺序 = 旧页面表头的顺序（= 旧页面存列顺序用的「原始列号」）。⛔ 不要改这个顺序：
 * 列顺序存在账号的 tour_col_order 里，存的是列号（"0".."16"），和旧页面共用——改了就和旧页面对不上。
 * label 是 ☰ Columns 里的名字（同旧页面 SYS_COL_NAMES）。
 */
export const SYSTEM_COLUMNS: readonly {
  key: SystemColumnKey;
  label: string;
}[] = [
  { key: "order_number", label: "Order #" },
  { key: "status", label: "Status" },
  { key: "tour", label: "Tour" },
  { key: "tour_date", label: "Tour Date" },
  { key: "guest_name", label: "Guest Name" },
  { key: "phone", label: "Phone" },
  { key: "party", label: "Party" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "turkey", label: "Turkey" },
  { key: "veggie", label: "Veggie" },
  { key: "beef", label: "Beef" },
  { key: "mtlv", label: "MTLV" },
  { key: "tickets", label: "Tickets" },
  { key: "notes", label: "Notes" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "submitted", label: "Submitted" },
];

const DEFAULT_ORDER = SYSTEM_COLUMNS.map((c) => c.key);

/** 账号里的列顺序（列号数组的 JSON）→ 列键。列数对不上就当没存过（同旧页面的长度校验）。 */
export function parseLegacyOrder(raw: string | null): SystemColumnKey[] | null {
  if (!raw) return null;
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length !== DEFAULT_ORDER.length) return null;
  const keys = list.map((v) => DEFAULT_ORDER[Number(v)]);
  if (keys.some((k) => !k) || new Set(keys).size !== keys.length) return null;
  return keys as SystemColumnKey[];
}

/** 列键 → 账号里存的列号数组（字符串，同旧页面）。 */
export function toLegacyOrder(order: SystemColumnKey[]): string {
  return JSON.stringify(order.map((k) => String(DEFAULT_ORDER.indexOf(k))));
}

/** 隐藏的页面列、要显示的上传列：只存在这个浏览器（同旧页面，旧页面的键在旧后台域名下，带不过来）。 */
export type TourColumnVis = ColumnVisibility<SystemColumnKey>;
export const COLUMN_VIS_KEY = "npe_ops_tour_col_vis";
export const COLUMN_ORDER_CACHE_KEY = "npe_ops_tour_col_order";

export function defaultOrder(): SystemColumnKey[] {
  return [...DEFAULT_ORDER];
}

export function parseVis(raw: string | null): TourColumnVis {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<TourColumnVis>) : null;
    if (v && Array.isArray(v.hide) && Array.isArray(v.file)) {
      return {
        hide: v.hide.filter((k): k is SystemColumnKey =>
          DEFAULT_ORDER.includes(k as SystemColumnKey),
        ),
        file: v.file.filter((h): h is string => typeof h === "string" && !!h),
      };
    }
  } catch {
    // 读不懂就用默认。
  }
  return { hide: [], file: [] };
}

export type ColumnKey = SystemColumnKey | `file:${string}`;

export function isFileColumn(key: ColumnKey): key is `file:${string}` {
  return key.startsWith("file:");
}

/** 这天上传名单里出现过的表头（同名只取第一次，按出现顺序）。 */
export function uploadedHeaders(rows: TourTrackingRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows)
    for (const pair of row.upload_row ?? [])
      if (Array.isArray(pair) && pair[0] && !seen.has(pair[0]))
        seen.add(pair[0]);
  return [...seen];
}

export function uploadedValue(row: TourTrackingRow, header: string): string {
  return (
    row.upload_row?.find((p) => Array.isArray(p) && p[0] === header)?.[1] ?? ""
  );
}

/** 实际显示的列：系统列按顺序去掉隐藏的，再接上这天确实有的上传列（按文件里的顺序）。 */
export function visibleColumns(
  order: SystemColumnKey[],
  vis: TourColumnVis,
  headers: string[],
): ColumnKey[] {
  return [
    ...order.filter((k) => !vis.hide.includes(k)),
    ...headers
      .filter((h) => vis.file.includes(h))
      .map((h) => `file:${h}` as const),
  ];
}

// ── 状态 ────────────────────────────────────────────────────────────────────

export function statusOf(r: TourTrackingRow): string {
  return r.confirmation_status || "pending";
}

export const STATUS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "yes", label: "YES" },
  { value: "modify_req", label: "Modify" },
  { value: "pending", label: "Pending" },
  { value: "cancel", label: "Cancel" },
];

export const STATUS_CLASS: Record<string, string> = {
  yes: "border-emerald-300 bg-emerald-50 text-emerald-800",
  modify_req: "border-orange-300 bg-orange-50 text-orange-700",
  pending: "border-amber-300 bg-amber-50 text-amber-700",
  cancel: "border-red-300 bg-red-50 text-red-700",
};

export type DeliveryTone = "good" | "sent" | "bad" | "none";

/**
 * 短信状态按子串归类（同旧页面 smsClass / smsLabel）。⚠️ undelivered 必须先于 delivered 判断，
 * 否则退回的短信会显示成 Delivered。
 */
export function smsKind(
  s: string,
): "undelivered" | "delivered" | "sent" | "failed" | "" {
  if (!s) return "";
  if (s.includes("undelivered")) return "undelivered";
  if (s.includes("delivered")) return "delivered";
  if (s.includes("sent") || s.includes("queued")) return "sent";
  if (s.includes("failed")) return "failed";
  return "";
}

export function smsLabel(s: string): { label: string; tone: DeliveryTone } {
  switch (smsKind(s)) {
    case "undelivered":
      return { label: "Undelivered", tone: "bad" };
    case "delivered":
      return { label: "Delivered", tone: "good" };
    case "sent":
      return { label: "Sent", tone: "sent" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    default:
      return s ? { label: s, tone: "none" } : { label: "—", tone: "none" };
  }
}

/** Email：send_log 推出来的 email_state 优先，没有再看 bookings 里的原值（同旧页面）。 */
export function emailLabel(r: TourTrackingRow): {
  label: string;
  tone: DeliveryTone;
} {
  const state =
    r.email_state ||
    (r.email_status.startsWith("sent")
      ? "sent"
      : r.email_status.startsWith("failed")
        ? "failed"
        : "");
  switch (state) {
    case "clicked":
      return { label: "Clicked", tone: "good" };
    case "opened":
      return { label: "Opened", tone: "good" };
    case "delivered":
      return { label: "Delivered", tone: "good" };
    case "sent":
      return { label: "Sent", tone: "sent" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    default:
      return { label: "—", tone: "none" };
  }
}

/** 对话弹窗里电话 / 邮箱旁边那一小段（同旧页面 _renderNotesChannels，判据和表格同一套）。 */
export function smsBadgeOf(r: TourTrackingRow): ContactBadge | null {
  const { label, tone } = smsLabel(r.sms_status);
  if (label === "—") return null;
  return {
    text: `${tone === "bad" ? "✗" : tone === "good" ? "✓" : "·"} ${label}`,
    tone: tone === "bad" ? "bad" : tone === "good" ? "good" : "muted",
  };
}

export function emailBadgeOf(r: TourTrackingRow): ContactBadge | null {
  const { label, tone } = emailLabel(r);
  if (tone === "none") return null;
  return {
    text: `${tone === "bad" ? "✗" : "✓"} ${label}`,
    tone: tone === "bad" ? "bad" : "good",
  };
}

// ── 统计 ────────────────────────────────────────────────────────────────────

export interface TourStats {
  total: number;
  yes: number;
  modify: number;
  pending: number;
  cancel: number;
  /** 回复了的 / 发出去的；分母为 0 时 null。 */
  responseRate: number | null;
  lunch: {
    label: string;
    turkey: number;
    veggie: number;
    beef: number;
    hasBeef: boolean;
  }[];
}

/**
 * 同旧页面 updateStats：按筛选后的行算。回复率的分母是「发出去的单」——邮件看 bookings 原值以 sent 开头，
 * 或短信是 sent / delivered / undelivered（送没送到不改分母，Annie 2026-09-09）；failed 不算。
 * 午餐按 YES 的单、按午餐分组加总；组里有带牛肉的团才显示牛肉。
 */
export function computeStats(
  rows: TourTrackingRow[],
  meta: TourMeta,
): TourStats {
  const count = (s: string) => rows.filter((r) => statusOf(r) === s).length;
  const reached = rows.filter(
    (r) =>
      r.email_status.startsWith("sent") ||
      ["sent", "delivered", "undelivered"].includes(smsKind(r.sms_status)),
  );
  const replied = reached.filter((r) => statusOf(r) !== "pending").length;
  const yes = rows.filter((r) => statusOf(r) === "yes");
  const lunch = meta.lunchGroups.flatMap((g) => {
    const gr = yes.filter((r) => g.types.includes(r.tour_type));
    if (!gr.length) return [];
    return [
      {
        label: g.label,
        turkey: gr.reduce((s, r) => s + (r.lunch_turkey || 0), 0),
        veggie: gr.reduce((s, r) => s + (r.lunch_veggie || 0), 0),
        beef: gr.reduce((s, r) => s + (r.lunch_beef || 0), 0),
        hasBeef: gr.some((r) => meta.hasBeef(r.tour_type)),
      },
    ];
  });
  return {
    total: rows.length,
    yes: count("yes"),
    modify: count("modify_req"),
    pending: count("pending"),
    cancel: count("cancel"),
    responseRate: reached.length
      ? Math.round((replied / reached.length) * 100)
      : null,
    lunch,
  };
}

export type BubbleTone = "none" | "todo" | "done";

/** Notes 表头：有对话（含确认页留言）的单里没人处理的数；都处理了显示有对话的单数。 */
export function notesBubble(rows: TourTrackingRow[]): {
  count: number;
  tone: BubbleTone;
} {
  const withNotes = rows.filter(
    (r) => r.notes_count + r.wa_count > 0 || !!r.notes,
  );
  if (!withNotes.length) return { count: 0, tone: "none" };
  const todo = withNotes.filter((r) => !r.action_taken_by).length;
  return todo
    ? { count: todo, tone: "todo" }
    : { count: withNotes.length, tone: "done" };
}

const ticketStatus = (r: TourTrackingRow) =>
  r.mtlv_ticket_status || "pending_send";
const hasQty = (r: TourTrackingRow) =>
  r.mtlv_qty !== null && r.mtlv_qty !== undefined;

/** MTLV 表头：有资格的单里还没了结的（客人没回，或回了但票没发 / 没取消）；都了结了显示已了结的数。 */
export function mtlvBubble(rows: TourTrackingRow[]): {
  count: number;
  tone: BubbleTone;
} {
  const elig = rows.filter((r) => r.mtlv_eligible);
  if (!elig.length) return { count: 0, tone: "none" };
  const todo = elig.filter(
    (r) =>
      !hasQty(r) ||
      (ticketStatus(r) !== "sent" && ticketStatus(r) !== "cancel"),
  ).length;
  return todo
    ? { count: todo, tone: "todo" }
    : { count: elig.length, tone: "done" };
}

/** Tickets 表头：客人回了张数的单里票还是 pending 的；没有就显示已发 / 已取消的数。 */
export function ticketsBubble(rows: TourTrackingRow[]): {
  count: number;
  tone: BubbleTone;
} {
  const elig = rows.filter((r) => r.mtlv_eligible && hasQty(r));
  if (!elig.length) return { count: 0, tone: "none" };
  const todo = elig.filter((r) => ticketStatus(r) === "pending_send").length;
  return todo
    ? { count: todo, tone: "todo" }
    : { count: elig.length, tone: "done" };
}

/** MTLV 两格怎么画（同旧页面）。 */
export function mtlvCells(
  r: TourTrackingRow,
):
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "waiting" }
  | { kind: "qty"; qty: number; sent: boolean } {
  if (!r.mtlv_eligible) return { kind: "none" };
  if (ticketStatus(r) === "cancel") return { kind: "cancel" };
  if (!hasQty(r)) return { kind: "waiting" };
  return {
    kind: "qty",
    qty: r.mtlv_qty ?? 0,
    sent: ticketStatus(r) === "sent",
  };
}

export function ticketValue(
  r: TourTrackingRow,
): "pending_send" | "sent" | "cancel" {
  const s = ticketStatus(r);
  return s === "sent" || s === "cancel" ? s : "pending_send";
}

// ── 排序 / 搜索 ─────────────────────────────────────────────────────────────

/** 后端已排好序；客人发来 WhatsApp 还没人处理的单顶到最上面（最新的在前），其余顺序不动。 */
export function orderRows(rows: TourTrackingRow[]): TourTrackingRow[] {
  const floated = rows
    .filter((r) => r.wa_unhandled)
    .sort((a, b) => (b.latest_wa_ts || "").localeCompare(a.latest_wa_ts || ""));
  return [...floated, ...rows.filter((r) => !r.wa_unhandled)];
}

export function matchesSearch(r: TourTrackingRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [r.order_number, r.guest_name, r.phone].some((v) =>
    (v || "").toLowerCase().includes(q),
  );
}

export function displayName(r: TourTrackingRow): string {
  return r.guest_name || r.first_name || "—";
}

// ── 群发 ────────────────────────────────────────────────────────────────────

/** 这天出现的团型（按显示顺序），label 是按钮上的短名（也存进群发记录，同旧页面）。 */
export function toursOnDate(
  rows: TourTrackingRow[],
  meta: TourMeta,
): { value: string; label: string }[] {
  const present = new Set(rows.map((r) => r.tour_type).filter(Boolean));
  const ordered = [
    ...meta.order.filter((k) => present.has(k)),
    ...[...present].filter((k) => !meta.order.includes(k)),
  ];
  return ordered.map((k) => ({ value: k, label: meta.abbr(k) }));
}

/** 群发候选人：所选团的全部客人（General）/ 有 MTLV 资格的（MTLV），不按状态筛（同旧页面）。 */
export function broadcastCandidates(
  rows: TourTrackingRow[],
): BroadcastCandidate[] {
  return rows.map((r) => ({
    key: String(r.id),
    orderNumber: r.order_number,
    name: r.guest_name || r.first_name || "",
    firstName: r.first_name || (r.guest_name || "").split(" ")[0] || "",
    phone: r.phone || "",
    email: r.email || "",
    tourType: r.tour_type,
    group: "pending",
    mtlv: r.mtlv_eligible,
  }));
}
