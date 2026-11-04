import { LA_TIME_ZONE } from "@/lib/la-date";
import type {
  ManifestField,
  ManifestHidden,
  ManifestPage,
  ManifestRow,
  ManifestTabKey,
  ManifestValue,
} from "@/types";

export const TAB_KEYS: readonly ManifestTabKey[] = ["bus", "tickets"];

export function isTabKey(value: string | null): value is ManifestTabKey {
  return value === "bus" || value === "tickets" || value === "admin_fee";
}

/** 两个标签各存各的列选择（后端契约 D）。 */
export const PREF_KEY = {
  bus: "manifest_cols_bus",
  tickets: "manifest_cols_tickets",
  admin_fee: "manifest_cols_admin_fee",
} as const;

/** staff 填的确认号那一列：表格里做成输入框。 */
export const STAFF_CFM_KEY = "staff_cfm";
/** Rezdy 自带的确认号那一列（和 staff 填的分两列）。后端判「有没有号」两个任一有值就算有（G129，Annie 2026-10-19）。 */
export const REZDY_CFM_KEY = "rezdy_cfm";

/**
 * 置顶 74：Brenda 每单 waiver link 那一列（表格里做成输入框，同 Cfm #）。
 * 列的规则（Annie 题 1 A）：这一页至少一单 waiver_link_required 才自动出现，紧跟在 Cfm # 后面；☰ Columns 里关掉
 * 就在存的列里记一个 WAIVER_OFF（不发给后端），以后不再自动加。
 */
export const WAIVER_KEY = "waiver_link";
export const WAIVER_STATUS_KEY = "waiver_status";
export const WAIVER_OFF = "-waiver_link";
/** 后端 waiver_status 的两种字（其余 = ""）。 */
export const WAIVER_MISSING = "No waiver link";
export const WAIVER_CHANGED = "Changed since sent";

/**
 * 勾选 / 发送要用、但 staff 可能没选来显示的列：每次都多要一份，表格和导出只显示 staff 选的。
 * 人数（选了几位 · 几人）、Cfm #（门票没填的勾不上）、发过没有（弹窗里写「已发过、会跳过」、门票行变灰）。
 */
const HELPER_FIELDS: Record<ManifestTabKey, readonly string[]> = {
  bus: ["pax", "sent_tour_at"],
  tickets: [
    "pax",
    STAFF_CFM_KEY,
    REZDY_CFM_KEY,
    "sent_tickets_at",
    WAIVER_KEY,
    WAIVER_STATUS_KEY,
    "waiver_link_by",
    "waiver_link_at",
  ],
  admin_fee: ["pax"],
};

/** 请求的列：没存过（null）就用后端默认列（默认列本来就含这几项）；存过的补上缺的辅助列。 */
export function requestFields(
  saved: string[] | null,
  tab: ManifestTabKey,
): string[] | null {
  if (!saved) return null;
  // 「-键」只是前端记的「这一列我关掉了」，不发给后端。
  const keys = saved.filter((k) => !k.startsWith("-"));
  return [...keys, ...HELPER_FIELDS[tab].filter((k) => !keys.includes(k))];
}

/** 这一页有没有要 waiver link 的单（列和上传键都看它）。 */
export function pageNeedsWaiver(rows: readonly ManifestRow[]): boolean {
  return rows.some((r) => r.waiver_link_required === true);
}

/**
 * 表格显示的列加上自动出现的 Waiver link（题 1 A）：这一页要、staff 没在 ☰ Columns 关掉、还没在列里 ⇒
 * 插在 Cfm # 后面（没有 Cfm # 列就放最后）。
 */
export function withWaiverColumn(
  fields: string[],
  rows: readonly ManifestRow[],
  saved: readonly string[] | null | undefined,
): string[] {
  if (!pageNeedsWaiver(rows)) return fields.filter((k) => k !== WAIVER_KEY);
  if (fields.includes(WAIVER_KEY) || saved?.includes(WAIVER_OFF)) return fields;
  const at = fields.indexOf(STAFF_CFM_KEY);
  return at < 0
    ? [...fields, WAIVER_KEY]
    : [...fields.slice(0, at + 1), WAIVER_KEY, ...fields.slice(at + 1)];
}

/**
 * ☰ Columns 存之前：这一页会自动出 Waiver link、staff 却没勾它 ⇒ 记一个 WAIVER_OFF（以后不再自动加）；
 * 勾了 ⇒ 去掉以前记的 WAIVER_OFF。
 */
export function rememberWaiverChoice(
  fields: string[],
  rows: readonly ManifestRow[],
): string[] {
  const keys = fields.filter((k) => k !== WAIVER_OFF);
  if (!pageNeedsWaiver(rows) || keys.includes(WAIVER_KEY)) return keys;
  return [...keys, WAIVER_OFF];
}

/** 这一行要 waiver link、但还没填。 */
export function missingWaiver(row: ManifestRow): boolean {
  return row.waiver_link_required === true && !hasValue(row.values[WAIVER_KEY]);
}

/** G245：这一行 Rezdy 的 Cfm # 跟产品不符（只看门票）。 */
export function cfmMismatch(
  row: ManifestRow,
  tab: ManifestTabKey,
): { other_label: string; other_value: string } | null {
  return tab === "tickets" ? (row.cfm_mismatch ?? null) : null;
}

/** 发送前红条里写的原因（同后端 blocked 的原话）。 */
export function cfmMismatchReason(m: {
  other_label: string;
  other_value: string;
}): string {
  return `Cfm # doesn't match the product (${m.other_label}: ${m.other_value})`;
}

/** 红格的提示（Annie：鼠标停上去显示、简短，告诉 staff 去 Rezdy 改）。 */
export function cfmMismatchTip(m: {
  other_label: string;
  other_value: string;
}): string {
  return `Wrong Cfm # for this product — Rezdy has it under ${m.other_label}: ${m.other_value}. Fix it in Rezdy.`;
}

/**
 * 门票这一行发送前缺什么（同后端 split_ticket_soft_blocks，一行两个原因合成一条）：
 * 「No Cfm #」「No waiver link」；不缺 = []。巴士不看。
 */
export function softBlocks(row: ManifestRow, tab: ManifestTabKey): string[] {
  if (tab !== "tickets") return [];
  return [
    ...(isSelectable(row, tab) ? [] : ["No Cfm #"]),
    ...(missingWaiver(row) ? [WAIVER_MISSING] : []),
    // G245：号不对是硬拦（不算进 Send anyway），原因同后端原话。
    ...(row.cfm_mismatch ? [cfmMismatchReason(row.cfm_mismatch)] : []),
  ];
}

/** 表格 / 导出显示的列：staff 选的（没存过就是后端返回的默认列），不显示只为勾选多要的辅助列。 */
export function shownFields(
  page: ManifestPage,
  saved: string[] | null | undefined,
): string[] {
  return saved ? page.fields.filter((k) => saved.includes(k)) : page.fields;
}

function hasValue(v: ManifestValue | undefined): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** 这一行这个标签要发的东西发过没有（Bus = 团确认、Tickets = 门票提醒，哪个页面发的都算）。 */
export function sentAt(row: ManifestRow, tab: ManifestTabKey): string {
  if (tab === "admin_fee") return "";
  const v = row.values[tab === "bus" ? "sent_tour_at" : "sent_tickets_at"];
  return hasValue(v) ? String(v) : "";
}

/**
 * 发送弹窗的名单表要用、列表不一定拉了的列（弹窗打开时自己补拉一次）。
 * Bus 拉 `guest_pickup_time` = 客人收到的接客时间（后端减 15，`9102912` 已上线），
 * 和 `bus_tour_type` = 产品的默认 tour type（后端 auto-send），Send tour confirmation 用它预填每节的下拉；
 * `product` = shuttle 节写「用哪个产品的 Shuttle 模板」（G189）。
 */
export const SEND_TABLE_FIELDS: Record<ManifestTabKey, readonly string[]> = {
  bus: [
    "guest_name",
    "guest_pickup_time",
    "sent_tour_by",
    "bus_tour_type",
    "product",
  ],
  tickets: ["guest_name", "sent_tickets_by"],
  admin_fee: [],
};

/**
 * 这一行是不是 shuttle（G189）：只认后端每行的 `shuttle`（口径同发送：产品的 booking_type，没有再看组的；
 * Boulder City 只有一节、sections=[] 也带）。旧后端没带 ⇒ 当团行，弹窗和现在一样——先于后端上线也不会让员工
 * 勾了 shuttle 行却被旧后端以「没选 tour type」拒掉。
 */
export function isShuttleRow(row: ManifestRow): boolean {
  return row.shuttle === true;
}

/**
 * 发送名单上写的接客时间 = 客人会收到的时间，只用 `guest_pickup_time`。
 * ⛔ 不退回 `pickup_time`：那是 Departure time（Rezdy 原时间），比客人收到的早 15 分钟；
 * 补拉失败或 Rezdy 时间读不出时宁可空着。
 */
export function guestPickupTime(row: ManifestRow): unknown {
  return row.values.guest_pickup_time;
}

/**
 * 「Sent by 谁 on 时间」（同旧后台发送页的 sent_label，谁发的空着写 staff）；没发过 ⇒ ""。
 * 还没拿到「谁发的」这一列（补拉没回来 / 失败）⇒ 只写时间。
 */
export function sentLabel(row: ManifestRow, tab: ManifestTabKey): string {
  const at = sentAt(row, tab);
  if (!at) return "";
  const byKey = tab === "bus" ? "sent_tour_by" : "sent_tickets_by";
  if (!(byKey in row.values)) return `Sent on ${formatLaDateTime(at)}`;
  const by = row.values[byKey];
  return `Sent by ${hasValue(by) ? String(by) : "staff"} on ${formatLaDateTime(at)}`;
}

/**
 * 能不能发：门票要先有 staff 的 Cfm #；巴士不受限。
 * ⚠️ 不是「能不能勾」——Annie 2026-10-17 改回手工点选：勾选本身不再被这个挡住，
 * 这个只用来算「勾了的里面哪些真能发」（pickedRows）和哪几行要标红提醒。
 * 原来 2026-10-09 定的「没填不让勾」已作废，见 PROGRESS.md。
 */
/** Main Manifest 所有勾选框的大小（Annie 2026-10-18：原来太小太难点中）：20px。 */
export const CHECK_BIG = "h-5 w-5 shrink-0 cursor-pointer";

export function isSelectable(row: ManifestRow, tab: ManifestTabKey): boolean {
  // 和后端 manifest_send.has_cfm() 一个判据（Annie 2026-10-20「改回」#1）：Rezdy 自带的号或 staff 填的号，任一个有就算有。
  return (
    tab === "bus" ||
    hasValue(row.values[STAFF_CFM_KEY]) ||
    hasValue(row.values[REZDY_CFM_KEY])
  );
}

/** 能勾、能发（没带 sendable 的旧后端 ⇒ 能）。CHD 组的行不能（见 ManifestRow.sendable）。 */
export function canSend(row: ManifestRow): boolean {
  return row.sendable !== false;
}

export function paxOf(row: ManifestRow): number {
  const v = row.values.pax;
  return typeof v === "number" ? v : Number(v) || 0;
}

/**
 * 节标题行的底色（后端说颜色前端自定）：去程 / 回程的 shuttle 一个颜色；团按节的先后轮流
 * （同 Annie 看过的样稿：紫 / 绿 / 粉）。
 */
const TOUR_SECTION_BG = ["#efe3f7", "#e2f2da", "#fbe3eb", "#e3eef6"];
export function sectionBg(kind: string, tourIndex: number): string {
  return kind === "tour"
    ? TOUR_SECTION_BG[tourIndex % TOUR_SECTION_BG.length]
    : "#fdebd9";
}

/**
 * 账号里存的列选择（置顶 71，Annie 2026-11-03）：每个标签一个键，值是 JSON
 * `{"shared": [...], "pages": {"<胶囊 key>": [...]}}`——shared 是整个标签共用的一套，pages 是某颗胶囊（Bus 的 group、
 * Tickets 的 tour type）自己的一套（Apply for this page）。null / 空数组 = 用后端默认列。
 * 旧值（一个数组）当 shared 读；第一次 Apply 写成新格式。坏值当「没存过」。
 * 今天没出现的键（unknown）、没权限的键（denied）照样留在里面，不删。
 */
export interface SavedCols {
  shared: string[] | null;
  pages: Record<string, string[] | null>;
}

export const EMPTY_COLS: SavedCols = { shared: null, pages: {} };

function cleanKeys(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const keys = value.filter(
    (k): k is string => typeof k === "string" && k !== "",
  );
  return keys.length ? [...new Set(keys)] : null;
}

export function parseSavedCols(value: string | null): SavedCols {
  if (!value) return EMPTY_COLS;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return { shared: cleanKeys(parsed), pages: {} };
    if (!parsed || typeof parsed !== "object") return EMPTY_COLS;
    const obj = parsed as { shared?: unknown; pages?: unknown };
    const pages: Record<string, string[] | null> = {};
    if (
      obj.pages &&
      typeof obj.pages === "object" &&
      !Array.isArray(obj.pages)
    ) {
      for (const [k, v] of Object.entries(
        obj.pages as Record<string, unknown>,
      )) {
        if (k && Array.isArray(v)) pages[k] = cleanKeys(v);
      }
    }
    return { shared: cleanKeys(obj.shared), pages };
  } catch {
    return EMPTY_COLS;
  }
}

/** 存回账号的字符串（新格式；null 写成空数组 = 默认列）。 */
export function serializeSavedCols(cols: SavedCols): string {
  return JSON.stringify({
    shared: cols.shared ?? [],
    pages: Object.fromEntries(
      Object.entries(cols.pages).map(([k, v]) => [k, v ?? []]),
    ),
  });
}

/** 这颗胶囊有没有自己的一套。 */
export function hasOwnCols(
  cols: SavedCols | null | undefined,
  pill: string,
): boolean {
  return (
    !!cols && !!pill && Object.prototype.hasOwnProperty.call(cols.pages, pill)
  );
}

/** 这颗胶囊用的列：有自己的用自己的，没有用 shared。 */
export function colsFor(cols: SavedCols, pill: string): string[] | null {
  return hasOwnCols(cols, pill) ? (cols.pages[pill] ?? null) : cols.shared;
}

const LA_DATETIME = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** ISO（带时区）→ 洛杉矶时间「Oct 7, 2026, 3:54 PM」；解析不了原样返回。 */
export function formatLaDateTime(iso: string): string {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? iso : LA_DATETIME.format(time);
}

function formatMoney(value: number, currency: ManifestValue): string {
  const code = typeof currency === "string" ? currency.trim() : "";
  if (/^[A-Za-z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code.toUpperCase(),
      }).format(value);
    } catch {
      // 不认识的币种代码：落到下面的纯数字。
    }
  }
  return value.toFixed(2);
}

/**
 * 一格的显示文字，按目录里的 type（契约 A）：datetime 换成洛杉矶时间；date、text 原样
 * （start_time / end_time 是 Rezdy 的当地时间原文，type 是 text，不换时区）；空值返回空串。
 */
export function formatValue(
  field: ManifestField | undefined,
  value: ManifestValue | undefined,
  row: ManifestRow,
): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field?.type) {
    case "bool":
      return value === true || value === "true" ? "Yes" : "No";
    case "datetime":
      return typeof value === "string"
        ? formatLaDateTime(value)
        : String(value);
    case "money":
      return typeof value === "number"
        ? formatMoney(value, row.values.currency)
        : String(value);
    default:
      return typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : String(value);
  }
}

export function isLegacy(row: ManifestRow): boolean {
  return row.lane_source === "legacy";
}

/**
 * 当前这一页（标签 + 胶囊）的 CSV：列 = 屏幕上的列，最后加一列标出老数据；分节时第一列是 Section
 * （后端接口说明 ① 的建议）。
 */
export function buildCsv(
  data: ManifestPage,
  fields: readonly string[],
): {
  headers: string[];
  rows: (string | number)[][];
} {
  const byKey = new Map(data.catalog.map((f) => [f.key, f]));
  const sections = data.sections ?? [];
  const titleOf = new Map(sections.map((s) => [s.key, s.title]));
  const headers = [
    ...(sections.length ? ["Section"] : []),
    ...fields.map((k) => byKey.get(k)?.label ?? k),
    "Legacy data",
  ];
  const rows = data.rows.map((r) => [
    ...(sections.length ? [titleOf.get(r.section ?? "") ?? ""] : []),
    ...fields.map((k) => {
      const field = byKey.get(k);
      const value = r.values[k];
      // 数字 / 金额导出原值，Excel 能直接算。
      if (
        typeof value === "number" &&
        (field?.type === "number" || field?.type === "money")
      ) {
        return value;
      }
      return formatValue(field, value, r);
    }),
    isLegacy(r) ? "legacy" : "",
  ]);
  return { headers, rows };
}

/**
 * Hidden rows 的 CSV（选着 Hidden rows 时导出）：列 = 屏幕上的列，前面加 Group，后面加 Why hidden。
 * 数字 / 金额导出原值。
 */
export function buildHiddenCsv(
  data: ManifestPage,
  hidden: ManifestHidden,
  fields: readonly string[],
): { headers: string[]; rows: (string | number)[][] } {
  const byKey = new Map(data.catalog.map((f) => [f.key, f]));
  const headers = [
    "Group",
    ...fields.map((k) => byKey.get(k)?.label ?? k),
    "Why hidden",
  ];
  const rows = hidden.rows.map((r) => [
    r.group_name,
    ...fields.map((k) => {
      const field = byKey.get(k);
      const value = r.values[k];
      if (
        typeof value === "number" &&
        (field?.type === "number" || field?.type === "money")
      ) {
        return value;
      }
      return formatValue(field, value, r as unknown as ManifestRow);
    }),
    r.reason_label,
  ]);
  return { headers, rows };
}

/** 文件名里的胶囊名：只留字母数字，其余换成 -。 */
export function csvFilename(data: ManifestPage): string {
  const pill = data.pills.find((p) => p.key === data.pill);
  const slug = (pill?.label ?? "all")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `manifest_${data.date}_${data.tab}_${slug || "all"}.csv`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
