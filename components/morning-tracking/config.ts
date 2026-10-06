import type { ContactBadge } from "@/components/ui/conversation-modal";
import { LA_TIME_ZONE } from "@/lib/la-date";
import type { MorningTrackingRow } from "@/types";

/** 与旧页面同频：60 秒一轮，只在看今天、且没过追踪窗口时自动刷新。 */
export const POLL_INTERVAL_MS = 60_000;

// ── 列 ──────────────────────────────────────────────────────────────────────

export type ColumnKey =
  | "order_number"
  | "name"
  | "checkin_status"
  | "checkin_time"
  | "notes"
  | "whatsapp"
  | "phone"
  | "quantities"
  | "vehicle_no"
  | "driver"
  | "pickup_time"
  | "pickup_location"
  | "sms_status"
  | "email_status"
  | "agent_name";

/** 默认顺序和表头文字照旧页面（tracking_morning.html 的 COL_DEFS）。键名不能改：列顺序存在账号偏好里，和旧页面共用。 */
export const COLUMNS: readonly { key: ColumnKey; label: string }[] = [
  { key: "order_number", label: "Order #" },
  { key: "name", label: "Name" },
  { key: "checkin_status", label: "Check-in" },
  { key: "checkin_time", label: "Check-in Time" },
  { key: "notes", label: "Notes" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "phone", label: "Phone" },
  { key: "quantities", label: "PAX" },
  { key: "vehicle_no", label: "Bus #" },
  { key: "driver", label: "Driver" },
  { key: "pickup_time", label: "Pickup Time" },
  { key: "pickup_location", label: "Pickup Location" },
  { key: "sms_status", label: "SMS Status" },
  { key: "email_status", label: "Email Status" },
  { key: "agent_name", label: "Agent" },
];

export const DEFAULT_COLUMN_ORDER: readonly ColumnKey[] = COLUMNS.map(
  (c) => c.key,
);

const KNOWN_KEYS = new Set<string>(DEFAULT_COLUMN_ORDER);

/**
 * 存下来的顺序 → 能用的顺序：认识的键按存的顺序，新加的列补在后面，不认识的丢掉。
 * 解析不了（不是 JSON 数组）时返回 null。
 */
export function parseColumnOrder(raw: string | null): ColumnKey[] | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const seen = new Set<string>();
  const order: ColumnKey[] = [];
  for (const key of parsed) {
    if (typeof key === "string" && KNOWN_KEYS.has(key) && !seen.has(key)) {
      seen.add(key);
      order.push(key as ColumnKey);
    }
  }
  for (const key of DEFAULT_COLUMN_ORDER) {
    if (!seen.has(key)) {
      order.push(key);
    }
  }
  return order;
}

/** 本机也存一份：账号偏好拉不到时先用它（和旧页面同一个键）。 */
export const LOCAL_COLUMN_ORDER_KEY = "npe_morning_col_order";

// ── 状态 ────────────────────────────────────────────────────────────────────

export type DeliveryTone = "good" | "bad" | "neutral" | "none";

/**
 * 短信状态是原始串（例 "sent:SM…"），按子串归类。⚠️ 顺序不能换：
 * "undelivered" 含 "delivered"，必须先判。
 */
export function smsStatusOf(raw: string): {
  label: string;
  tone: DeliveryTone;
  /** 算进签到率的分母（成功发出去的短信）。 */
  sent: boolean;
} {
  const s = raw.toLowerCase();
  if (!s) return { label: "—", tone: "none", sent: false };
  if (s.includes("undelivered"))
    return { label: "Undelivered", tone: "bad", sent: true };
  if (s.includes("delivered"))
    return { label: "Delivered", tone: "good", sent: true };
  if (s.includes("sent") || s.includes("queued"))
    return { label: "Sent", tone: "neutral", sent: true };
  if (s.includes("failed"))
    return { label: "Failed", tone: "bad", sent: false };
  return { label: raw, tone: "none", sent: false };
}

export function emailStatusOf(state: MorningTrackingRow["email_state"]): {
  label: string;
  tone: DeliveryTone;
} {
  switch (state) {
    case "clicked":
      return { label: "Clicked", tone: "good" };
    case "opened":
      return { label: "Opened", tone: "good" };
    case "delivered":
      return { label: "Delivered", tone: "good" };
    case "sent":
      return { label: "Sent", tone: "neutral" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    default:
      return { label: "—", tone: "none" };
  }
}

/** 对话弹窗里电话 / 邮箱旁边的小字：早先那条早班提醒有没有送到。 */
export function smsBadgeOf(raw: string): ContactBadge | null {
  const { label, tone } = smsStatusOf(raw);
  if (tone === "bad") return { text: `✗ ${label}`, tone: "bad" };
  if (tone === "good") return { text: `✓ ${label}`, tone: "good" };
  if (tone === "neutral") return { text: `· ${label}`, tone: "muted" };
  return null;
}

export function emailBadgeOf(
  state: MorningTrackingRow["email_state"],
): ContactBadge | null {
  const { label, tone } = emailStatusOf(state);
  if (tone === "bad") return { text: `✗ ${label}`, tone: "bad" };
  if (tone === "good") return { text: `✓ ${label}`, tone: "good" };
  if (tone === "neutral") return { text: `· ${label}`, tone: "muted" };
  return null;
}

// ── 时间 ────────────────────────────────────────────────────────────────────

const CHECKIN_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "10/3, 7:42 AM"（洛杉矶）。 */
export function formatCheckinTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? "—" : CHECKIN_FORMAT.format(time);
}

const DATE_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10-03" → "Sat, Oct 3, 2026"。按 UTC 解析再按 UTC 格式化，不会偏一天。 */
export function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? ymd : DATE_LABEL_FORMAT.format(date);
}

// ── 排序 / 筛选 / 统计 ──────────────────────────────────────────────────────

/**
 * 后端已按「签到的在前（新的在前），再按接客时间」排好。
 * 客人发来 WhatsApp 还没人处理的单顶到最上面（最新的在前），其余保持原顺序。
 */
export function orderRows(rows: MorningTrackingRow[]): MorningTrackingRow[] {
  const floated = rows
    .filter((r) => r.wa_unhandled)
    .sort((a, b) => (b.latest_wa_ts || "").localeCompare(a.latest_wa_ts || ""));
  return [...floated, ...rows.filter((r) => !r.wa_unhandled)];
}

export function matchesSearch(
  row: MorningTrackingRow,
  search: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [row.order_number, row.name, row.phone].some((v) =>
    (v || "").toLowerCase().includes(q),
  );
}

export interface DriverSummary {
  driver: string;
  checkedIn: number;
  total: number;
}

/** 司机按第一次出现的顺序；人数按全部行算（不受搜索影响）。 */
export function summarizeDrivers(rows: MorningTrackingRow[]): DriverSummary[] {
  const map = new Map<string, DriverSummary>();
  for (const row of rows) {
    if (!row.driver) {
      continue;
    }
    const entry = map.get(row.driver) ?? {
      driver: row.driver,
      checkedIn: 0,
      total: 0,
    };
    entry.total += 1;
    if (row.checkin_status === "checked_in") {
      entry.checkedIn += 1;
    }
    map.set(row.driver, entry);
  }
  return [...map.values()];
}

export interface TrackingStats {
  total: number;
  checkedIn: number;
  pending: number;
  /** 短信发出的单里签到的 / 短信发出的单数；分母为 0 时为 null。 */
  rate: number | null;
}

export function computeStats(rows: MorningTrackingRow[]): TrackingStats {
  const checkedIn = rows.filter(
    (r) => r.checkin_status === "checked_in",
  ).length;
  const smsSent = rows.filter((r) => smsStatusOf(r.sms_status).sent);
  // 分子只算短信发出去的单里签到的（同旧页面）；没收到短信自己签到的不算，否则会超过 100%。
  const sentCheckedIn = smsSent.filter(
    (r) => r.checkin_status === "checked_in",
  ).length;
  return {
    total: rows.length,
    checkedIn,
    pending: rows.length - checkedIn,
    rate: smsSent.length
      ? Math.round((sentCheckedIn / smsSent.length) * 100)
      : null,
  };
}

/** Notes 表头的数字：有对话的单里还没人处理的数量；都处理了显示有对话的单数（绿色）。 */
export function notesHeaderCount(rows: MorningTrackingRow[]): {
  count: number;
  tone: "none" | "unhandled" | "handled";
} {
  const withNotes = rows.filter((r) => r.notes_count + r.wa_count > 0);
  if (!withNotes.length) {
    return { count: 0, tone: "none" };
  }
  const unhandled = withNotes.filter((r) => !r.action_taken_by).length;
  return unhandled
    ? { count: unhandled, tone: "unhandled" }
    : { count: withNotes.length, tone: "handled" };
}
