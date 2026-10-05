import type { BroadcastCandidate } from "@/components/ui/broadcast-dialog";
import type { ContactBadge } from "@/components/ui/conversation-modal";
import { tourTypeLabel } from "@/components/tickets-send/config";
import { LA_TIME_ZONE } from "@/lib/la-date";
import type { TicketsTrackingRow } from "@/types";

/** 旧页面每 60 秒整表重拉一次，全天都拉（没有早班那样的截止时间）。 */
export const POLL_INTERVAL_MS = 60_000;

// ── 产品 ────────────────────────────────────────────────────────────────────

interface Product {
  slug: string;
  /** 产品按钮上的短名。 */
  short: string;
  /** Tour 列里的全名。 */
  label: string;
}

/** 按钮顺序、短名、全名照旧页面。后端新增产品时这里要跟着加（不认识的产品按钮显示代码）。 */
export const PRODUCTS: readonly Product[] = [
  {
    slug: "upper_antelope_tsosie",
    short: "U-TC",
    label: "Upper Antelope – Tsosie",
  },
  {
    slug: "upper_antelope_brenda",
    short: "U-BR",
    label: "Upper Antelope – Brenda",
  },
  {
    slug: "upper_antelope_aact",
    short: "U-AA",
    label: "Upper Antelope – AACT",
  },
  {
    slug: "upper_antelope_hogan_transport",
    short: "U-HT",
    label: "Upper Antelope – Hogan",
  },
  {
    slug: "upper_antelope_hogan_hiking",
    short: "U-HH",
    label: "Upper Antelope – Hogan Hike",
  },
  {
    slug: "lower_antelope_kens",
    short: "L-KT",
    label: "Lower Antelope – Ken's",
  },
  {
    slug: "lower_antelope_dixie",
    short: "L-DX",
    label: "Lower Antelope – Dixie's",
  },
  { slug: "canyon_x", short: "X-TT", label: "Antelope Canyon X" },
  { slug: "rattlesnake_aact", short: "R-AA", label: "Rattlesnake Canyon" },
  { slug: "secret_antelope_hbt", short: "SA", label: "Secret Antelope Canyon" },
  {
    slug: "secret_antelope_combo_hbt",
    short: "Combo-SA",
    label: "Combo - Secret Antelope + HB Overlook",
  },
];

const PRODUCT_BY_SLUG = new Map(PRODUCTS.map((p) => [p.slug, p]));

export function productLabel(slug: string): string {
  return PRODUCT_BY_SLUG.get(slug)?.label ?? tourTypeLabel(slug);
}

export interface ProductPill {
  slug: string;
  short: string;
  /** 回复 YES 的人数 / 总人数（按 Pax 加总，不受搜索影响）。 */
  yesPax: number;
  totalPax: number;
}

/**
 * 固定的产品按钮 + 这天出现了但不在清单里的产品（旧页面没有按钮，只能在 Total 里看到）。
 */
export function productPills(rows: TicketsTrackingRow[]): ProductPill[] {
  const extra = [...new Set(rows.map((r) => r.tour_type))].filter(
    (slug) => slug && !PRODUCT_BY_SLUG.has(slug),
  );
  const list = [
    ...PRODUCTS.map((p) => ({ slug: p.slug, short: p.short })),
    // 例如 Brenda 免 permit fee：用发送页的产品名。
    ...extra.map((slug) => ({ slug, short: tourTypeLabel(slug) })),
  ];
  return list.map(({ slug, short }) => {
    const mine = rows.filter((r) => r.tour_type === slug);
    return {
      slug,
      short,
      yesPax: sumPax(mine.filter((r) => r.confirmation_status === "yes")),
      totalPax: sumPax(mine),
    };
  });
}

export function sumPax(rows: TicketsTrackingRow[]): number {
  return rows.reduce((total, r) => total + (r.quantities || 0), 0);
}

// ── 列 ──────────────────────────────────────────────────────────────────────

export type SystemColumnKey =
  | "tour"
  | "tour_date"
  | "order_number"
  | "quantities"
  | "checkin_time"
  | "tour_time"
  | "guest_name"
  | "phone"
  | "confirmation_no"
  | "email"
  | "sms"
  | "notes"
  | "whatsapp"
  | "status"
  | "submitted_at";

export const SYSTEM_COLUMNS: readonly {
  key: SystemColumnKey;
  label: string;
}[] = [
  { key: "tour", label: "Tour" },
  { key: "tour_date", label: "Service Date" },
  { key: "order_number", label: "CHD#" },
  { key: "quantities", label: "Pax" },
  { key: "checkin_time", label: "Check-in Time" },
  { key: "tour_time", label: "Tour Time" },
  { key: "guest_name", label: "Guest Name" },
  { key: "phone", label: "Phone" },
  { key: "confirmation_no", label: "Confirmation#" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "notes", label: "Notes" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "status", label: "Status" },
  { key: "submitted_at", label: "Submit Time" },
];

const SYSTEM_KEYS = new Set<string>(SYSTEM_COLUMNS.map((c) => c.key));

/** 上传名单的列：键是 "file:" + 表头。 */
export type ColumnKey = SystemColumnKey | `file:${string}`;

export function isFileColumn(key: ColumnKey): key is `file:${string}` {
  return key.startsWith("file:");
}

/** 这天上传名单里出现过的表头（同名只取第一次，按出现顺序）。 */
export function uploadedHeaders(rows: TicketsTrackingRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const [header] of row.upload_row ?? []) {
      if (header && !seen.has(header)) {
        seen.add(header);
      }
    }
  }
  return [...seen];
}

export function uploadedValue(row: TicketsTrackingRow, header: string): string {
  return row.upload_row?.find(([h]) => h === header)?.[1] ?? "";
}

/**
 * 列设置存进账号（tickets_col_order，2026-10-03 起），本机另有一份缓存先画。
 * order：系统列的顺序；hide：隐藏的系统列；file：要显示的上传列表头（按勾选顺序排在最右）。
 */
export interface ColumnPrefs {
  order: SystemColumnKey[];
  hide: SystemColumnKey[];
  file: string[];
}

export const COLUMN_PREFS_KEY = "npe_ops_tickets_columns";

export function defaultColumnPrefs(): ColumnPrefs {
  return { order: SYSTEM_COLUMNS.map((c) => c.key), hide: [], file: [] };
}

/** 读回来的设置：不认识的键丢掉，新加的系统列补在后面。 */
export function parseColumnPrefs(raw: string | null): ColumnPrefs {
  const prefs = defaultColumnPrefs();
  if (!raw) {
    return prefs;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (!parsed || typeof parsed !== "object") {
    return prefs;
  }
  const value = parsed as Record<string, unknown>;
  const asKeys = (list: unknown): SystemColumnKey[] =>
    Array.isArray(list)
      ? [
          ...new Set(
            list.filter(
              (k): k is SystemColumnKey =>
                typeof k === "string" && SYSTEM_KEYS.has(k),
            ),
          ),
        ]
      : [];
  const order = asKeys(value.order);
  for (const key of prefs.order) {
    if (!order.includes(key)) {
      order.push(key);
    }
  }
  return {
    order,
    hide: asKeys(value.hide),
    file: Array.isArray(value.file)
      ? [
          ...new Set(
            value.file.filter((h): h is string => typeof h === "string" && !!h),
          ),
        ]
      : [],
  };
}

/** 实际显示的列：系统列按顺序去掉隐藏的，再接上这天确实有的上传列。 */
export function visibleColumns(
  prefs: ColumnPrefs,
  headers: string[],
): ColumnKey[] {
  const system = prefs.order.filter((k) => !prefs.hide.includes(k));
  const files = prefs.file
    .filter((h) => headers.includes(h))
    .map((h) => `file:${h}` as const);
  return [...system, ...files];
}

// ── 状态 ────────────────────────────────────────────────────────────────────

export type DeliveryTone = "good" | "bad" | "none";

/** 短信状态按原值精确对照（门票页旧口径，和早班页的子串归类不同）。 */
export function smsLabel(raw: string): { label: string; tone: DeliveryTone } {
  switch (raw) {
    case "delivered":
      return { label: "✓ Delivered", tone: "good" };
    case "sent":
    case "queued":
      return { label: "✓ Sent", tone: "good" };
    case "failed":
      return { label: "✗ Failed", tone: "bad" };
    case "undelivered":
      return { label: "✗ Undelivered", tone: "bad" };
    default:
      return { label: "—", tone: "none" };
  }
}

/** Email 列：先看 send_log 推出来的 email_state，没有再看表里的原值。 */
export function emailLabel(row: TicketsTrackingRow): {
  label: string;
  tone: DeliveryTone;
} {
  switch (row.email_state || row.email_status) {
    case "clicked":
      return { label: "✓ Clicked", tone: "good" };
    case "opened":
      return { label: "✓ Opened", tone: "good" };
    case "delivered":
      return { label: "✓ Delivered", tone: "good" };
    case "sent":
      return { label: "✓ Sent", tone: "good" };
    case "failed":
      return { label: "✗ Failed", tone: "bad" };
    default:
      return { label: "—", tone: "none" };
  }
}

function badgeOf({
  label,
  tone,
}: {
  label: string;
  tone: DeliveryTone;
}): ContactBadge | null {
  if (tone === "none") return null;
  return { text: label, tone: tone === "good" ? "good" : "bad" };
}

export function smsBadgeOf(row: TicketsTrackingRow): ContactBadge | null {
  return badgeOf(smsLabel(row.sms_status));
}

export function emailBadgeOf(row: TicketsTrackingRow): ContactBadge | null {
  return badgeOf(emailLabel(row));
}

/**
 * 状态下拉的选项（Annie 2026-10-03 定：保留 Cancel，等后端支持）。
 * 客人申请改期（reschedule_req）的单另显示一个只读的 Reschedule，不能选回去。
 */
export const STATUS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "yes", label: "✓ YES" },
  { value: "pending", label: "⌛ Pending" },
  { value: "cancel", label: "✕ Cancel" },
];

export const STATUS_CLASS: Record<string, string> = {
  yes: "border-emerald-300 bg-emerald-50 text-emerald-800",
  pending: "border-amber-300 bg-amber-50 text-amber-700",
  cancel: "border-red-300 bg-red-50 text-red-700",
  reschedule_req: "border-orange-300 bg-orange-50 text-orange-700",
};

// ── 统计 ────────────────────────────────────────────────────────────────────

export interface TicketsStats {
  orders: number;
  yes: number;
  reschedule: number;
  pending: number;
  cancelled: number;
  /** 已回复 / 通知送到的单；分母为 0 时为 null。 */
  responseRate: number | null;
}

const delivered = (s: string) =>
  s === "delivered" || s === "sent" || s === "queued";

/** 公式照旧页面：Response Rate 的分母是邮件或短信送到的单（邮件看表里的原值）。 */
export function computeStats(rows: TicketsTrackingRow[]): TicketsStats {
  let yes = 0;
  let reschedule = 0;
  let cancelled = 0;
  let pending = 0;
  for (const r of rows) {
    const cs = r.confirmation_status;
    if (cs === "yes") yes++;
    else if (cs === "reschedule_req") reschedule++;
    else if (cs === "cancel") cancelled++;
    else pending++;
  }
  const reached = rows.filter(
    (r) => delivered(r.email_status) || delivered(r.sms_status),
  );
  const replied = reached.filter(
    (r) => (r.confirmation_status || "pending") !== "pending",
  );
  return {
    orders: rows.length,
    yes,
    reschedule,
    pending,
    cancelled,
    responseRate: reached.length
      ? Math.round((replied.length / reached.length) * 100)
      : null,
  };
}

// ── 排序 / 搜索 / 时间 ──────────────────────────────────────────────────────

/** 后端已排好序；客人发来 WhatsApp 还没人处理的单顶到最上面（最新的在前）。 */
export function orderRows(rows: TicketsTrackingRow[]): TicketsTrackingRow[] {
  const floated = rows
    .filter((r) => r.wa_unhandled)
    .sort((a, b) => (b.latest_wa_ts || "").localeCompare(a.latest_wa_ts || ""));
  return [...floated, ...rows.filter((r) => !r.wa_unhandled)];
}

export function matchesSearch(
  row: TicketsTrackingRow,
  search: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [row.order_number, row.guest_name, row.phone].some((v) =>
    (v || "").toLowerCase().includes(q),
  );
}

/** 有对话（含确认页留言）的单里还没人处理的数量；都处理了显示有对话的单数。 */
export function notesHeaderCount(rows: TicketsTrackingRow[]): {
  count: number;
  tone: "none" | "unhandled" | "handled";
} {
  const withNotes = rows.filter(
    (r) => r.notes_count + r.wa_count > 0 || !!r.guest_notes,
  );
  if (!withNotes.length) {
    return { count: 0, tone: "none" };
  }
  const unhandled = withNotes.filter((r) => !r.action_taken_by).length;
  return unhandled
    ? { count: unhandled, tone: "unhandled" }
    : { count: withNotes.length, tone: "handled" };
}

const SUBMITTED_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatSubmitted(iso: string | null): string {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(time) ? "—" : SUBMITTED_FORMAT.format(time);
}

// ── 群发 ────────────────────────────────────────────────────────────────────

/** 产品按钮上的短名（也作为群发记录里的产品名，同旧页面）。 */
export function productShort(slug: string): string {
  return PRODUCT_BY_SLUG.get(slug)?.short ?? tourTypeLabel(slug);
}

/** 这天出现的产品，按固定顺序（不认识的排在后面）。 */
export function toursOnDate(
  rows: TicketsTrackingRow[],
): { value: string; label: string }[] {
  const present = new Set(rows.map((r) => r.tour_type).filter(Boolean));
  const known = PRODUCTS.filter((p) => present.has(p.slug)).map((p) => p.slug);
  const extra = [...present].filter((slug) => !PRODUCT_BY_SLUG.has(slug));
  return [...known, ...extra].map((slug) => ({
    value: slug,
    label: productShort(slug),
  }));
}

/**
 * 群发候选人。只有回复 YES 的和还没回复的能收群发（Annie 2026-09-11 定），
 * 改期 / 取消等其他状态 group 为 null。
 */
export function broadcastCandidates(
  rows: TicketsTrackingRow[],
): BroadcastCandidate[] {
  return rows.map((r) => {
    const status = r.confirmation_status || "pending";
    return {
      key: String(r.id),
      orderNumber: r.order_number,
      name: r.guest_name,
      firstName: r.guest_name.trim().split(/\s+/)[0] ?? "",
      phone: r.phone,
      email: r.email,
      tourType: r.tour_type,
      group:
        status === "yes"
          ? "confirmed"
          : status === "pending"
            ? "pending"
            : null,
    };
  });
}
