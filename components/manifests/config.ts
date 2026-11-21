import { LA_TIME_ZONE } from "@/lib/la-date";
import type {
  ManifestField,
  ManifestHidden,
  ManifestListSection,
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
    // 153：场次分组要用（开始时间、产品、人数细分），staff 在 ☰ Columns 关掉了也照样分组。
    "start_time",
    "product",
    "pax_breakdown",
  ],
  admin_fee: ["pax"],
};

/** 请求的列：没存过（null）就用后端默认列（默认列本来就含这几项）；存过的补上缺的辅助列。 */
export function requestFields(
  saved: string[] | null,
  tab: ManifestTabKey,
): string[] | null {
  if (!saved) return null;
  // 「-键」只是前端记的「这一列我关掉了」，不发给后端；Notes 是前端自己的列（值在行上，不在 catalog），也不发。
  // Relay / Tour（_relay / _tour）同理。
  const keys = saved.filter((k) => !k.startsWith("-") && !k.startsWith("_"));
  return [...keys, ...HELPER_FIELDS[tab].filter((k) => !keys.includes(k))];
}

/**
 * 150 Relay / Tour 两列（G321，Annie N6「就显示简单一点，直接是relay和tour的结果就好了」）：Bus 标签只读，
 * 只写后端的 label（Picked up / Boarded / No show），没标 ⇒ 空（格子画「—」）；relay_applicable=false ⇒ Relay 也是「—」。
 * 不要 hover、不能改。默认紧跟 Morning pickup sent（没有那列就跟 Tour confirmation sent，再没有放 Notes 前 / 最后）。
 * ☰ Columns 能关（-_relay / -_tour）、能拖；后端没给 relay_mark ⇒ 不出（旧后端）。列名「Tour」Annie 还没最后确认。
 */
export const RELAY_KEY = "_relay";
export const TOUR_KEY = "_tour";
const MARK_FIELDS: ManifestField[] = [
  { key: RELAY_KEY, label: "Relay", group: "ours", type: "text" },
  { key: TOUR_KEY, label: "Tour", group: "ours", type: "text" },
];

export function marksOn(page: ManifestPage): boolean {
  return page.tab === "bus" && page.rows.some((r) => "relay_mark" in r);
}

export function withMarks(page: ManifestPage): ManifestPage {
  if (!marksOn(page)) return page;
  const have = new Set(page.catalog.map((f) => f.key));
  return {
    ...page,
    catalog: [...page.catalog, ...MARK_FIELDS.filter((f) => !have.has(f.key))],
    rows: page.rows.map((r) => ({
      ...r,
      values: {
        ...r.values,
        [RELAY_KEY]:
          r.relay_applicable === false ? "" : (r.relay_mark?.label ?? ""),
        [TOUR_KEY]: r.bus_mark?.label ?? "",
      },
    })),
  };
}

/** 显示 / ☰ Columns 用的列加上 Relay、Tour（规则同 withNoteColumn，默认位置见上）。 */
export function withMarkColumns(
  fields: string[],
  page: ManifestPage,
  saved: readonly string[] | null | undefined,
): string[] {
  let keys = fields.filter((k) => k !== `-${RELAY_KEY}` && k !== `-${TOUR_KEY}`);
  for (const key of [RELAY_KEY, TOUR_KEY]) {
    if (!marksOn(page) || saved?.includes(`-${key}`)) {
      keys = keys.filter((k) => k !== key);
      continue;
    }
    if (keys.includes(key)) continue;
    const at = saved ? saved.indexOf(key) : -1;
    let pos: number;
    if (at >= 0) {
      const before = saved!
        .slice(0, at)
        .reverse()
        .find((k) => keys.includes(k));
      pos = before === undefined ? 0 : keys.indexOf(before) + 1;
    } else {
      const anchor = [
        ...(key === TOUR_KEY ? [RELAY_KEY] : []),
        "sent_morning_at",
        "sent_tour_at",
      ].find((k) => keys.includes(k));
      pos =
        anchor !== undefined
          ? keys.indexOf(anchor) + 1
          : keys.includes(NOTE_KEY)
            ? keys.indexOf(NOTE_KEY)
            : keys.length;
    }
    keys = [...keys.slice(0, pos), key, ...keys.slice(pos)];
  }
  return keys;
}

/** ☰ Columns / 拖表头存之前：这页有 Relay / Tour、staff 没勾 ⇒ 记 -_relay / -_tour。 */
export function rememberMarkChoice(
  fields: string[],
  page: ManifestPage,
): string[] {
  const keys = fields.filter(
    (k) => k !== `-${RELAY_KEY}` && k !== `-${TOUR_KEY}`,
  );
  if (!marksOn(page)) return keys;
  return [
    ...keys,
    ...[RELAY_KEY, TOUR_KEY]
      .filter((k) => !keys.includes(k))
      .map((k) => `-${k}`),
  ];
}

/**
 * 150 Notes（G321 v171，Annie「notes可以先上」）：后端把备注放在每行的 `note` 上，不在 catalog / fields 里。
 * 前端把它当成一列（键 NOTE_KEY），Bus、Tickets 两个标签有（题 9 A）：默认放最后（题 4 A）；
 * ☰ Columns 里能关（关掉记 NOTE_OFF，同 Waiver link 的 WAIVER_OFF）、能拖位置；Export CSV 照屏幕上的列带出。
 */
export const NOTE_KEY = "_note";
export const NOTE_OFF = "-_note";
export const NOTE_FIELD: ManifestField = {
  key: NOTE_KEY,
  label: "Notes",
  group: "ours",
  type: "text",
};

/** 这一页出不出 Notes 列：Bus、Tickets 标签，而且后端给了 note（旧后端没有 ⇒ 不出）。 */
export function notesOn(page: ManifestPage): boolean {
  return (
    (page.tab === "bus" || page.tab === "tickets") &&
    page.rows.some((r) => typeof r.note === "string")
  );
}

/** 把 Notes 放进这一页：catalog 多一项（表头、☰ Columns、CSV 都用它的名字），每行 values 多一格（CSV 照常导）。 */
export function withNotes(page: ManifestPage): ManifestPage {
  if (!notesOn(page)) return page;
  return {
    ...page,
    catalog: page.catalog.some((f) => f.key === NOTE_KEY)
      ? page.catalog
      : [...page.catalog, NOTE_FIELD],
    rows: page.rows.map((r) => ({
      ...r,
      values: { ...r.values, [NOTE_KEY]: r.note ?? "" },
    })),
  };
}

/**
 * 显示 / ☰ Columns 用的列加上 Notes：这页没有 ⇒ 去掉；staff 关掉过（NOTE_OFF）⇒ 不加；已经在 ⇒ 不动；
 * 存的列里有它（拖过位置）⇒ 插回存的位置；都没有 ⇒ 放最后。
 */
export function withNoteColumn(
  fields: string[],
  page: ManifestPage,
  saved: readonly string[] | null | undefined,
): string[] {
  const keys = fields.filter((k) => k !== NOTE_OFF);
  if (!notesOn(page) || saved?.includes(NOTE_OFF))
    return keys.filter((k) => k !== NOTE_KEY);
  if (keys.includes(NOTE_KEY)) return keys;
  const at = saved ? saved.indexOf(NOTE_KEY) : -1;
  if (at < 0) return [...keys, NOTE_KEY];
  // 存的顺序里 Notes 前面最近一个还在显示的列，插在它后面；前面没有就放第一个。
  const before = saved!
    .slice(0, at)
    .reverse()
    .find((k) => keys.includes(k));
  const pos = before === undefined ? 0 : keys.indexOf(before) + 1;
  return [...keys.slice(0, pos), NOTE_KEY, ...keys.slice(pos)];
}

/** ☰ Columns / 拖表头存之前：这页有 Notes、staff 没勾 ⇒ 记 NOTE_OFF；勾了 ⇒ 去掉以前记的 NOTE_OFF。 */
export function rememberNoteChoice(
  fields: string[],
  page: ManifestPage,
): string[] {
  const keys = fields.filter((k) => k !== NOTE_OFF);
  if (!notesOn(page) || keys.includes(NOTE_KEY)) return keys;
  return [...keys, NOTE_OFF];
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

/** 发送前红条 / 后端 blocked 的原话（同后端 manifest_send.NO_CFM_REASON / SHORT_CFM_REASON）。 */
export const NO_CFM_REASON = "No Cfm #";
export const SHORT_CFM_REASON = "Cfm # is too short (under 6 digits)";

/**
 * 门票这一行的 Cfm # 够不够发（同后端 manifest_send.cfm_problem()，后端 51ffe2ca）：
 * 不需要号的团（cfm_not_needed）⇒ null；没号 ⇒「No Cfm #」；号不到 6 位数字（cfm_short）⇒ 短号原因。巴士不看。
 */
export function cfmProblem(
  row: ManifestRow,
  tab: ManifestTabKey,
): string | null {
  if (tab !== "tickets" || row.cfm_not_needed) return null;
  if (!isSelectable(row, tab)) return NO_CFM_REASON;
  return row.cfm_short ? SHORT_CFM_REASON : null;
}

/**
 * 门票这一行发送前缺什么（同后端 split_ticket_soft_blocks，一行两个原因合成一条）：
 * 「No Cfm #」/「Cfm # is too short (under 6 digits)」「No waiver link」；不缺 = []。巴士不看。
 */
export function softBlocks(row: ManifestRow, tab: ManifestTabKey): string[] {
  if (tab !== "tickets") return [];
  const cfm = cfmProblem(row, tab);
  return [
    ...(cfm ? [cfm] : []),
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

// ── 153 Tickets 按场次分组（Annie「我要这样的，类似antelope bus的分支，然后可以折叠，可以全选可以选session，也可以单独选订单」「动手」）──

/** 后端 start_time 是 Rezdy 的当地时间原文「2026-11-17 09:00:00」；取出时分写成「9:00 AM」。读不出 ⇒ ""。 */
export function sessionTime(value: ManifestValue | undefined): string {
  const m = /(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!m) return "";
  const h = Number(m[1]);
  if (h > 23) return "";
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** 后端 pax_breakdown「2 Adult, 1 Child」：一组里各单加起来「13 Adult / 1 Infant」（按第一次出现的顺序）；一单都读不出 ⇒ ""。 */
function sumBreakdown(rows: readonly ManifestRow[]): string {
  const total = new Map<string, number>();
  for (const r of rows) {
    for (const part of String(r.values.pax_breakdown ?? "").split(",")) {
      const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(part);
      if (m) total.set(m[2], (total.get(m[2]) ?? 0) + Number(m[1]));
    }
  }
  return [...total].map(([label, n]) => `${n} ${label}`).join(" / ");
}

/** 这一行的场次组键：开始时间原文 + 产品；没有开始时间 ⇒ No time 组。 */
export const NO_TIME_KEY = "no_time";
function sessionKeyOf(row: ManifestRow): string {
  const t = String(row.values.start_time ?? "").trim();
  if (!sessionTime(t)) return NO_TIME_KEY;
  return `session:${t}|${String(row.values.product ?? row.product_code)}`;
}

/**
 * Tickets 标签：后端不分节 ⇒ 前端按「开始时间 + 产品」分成场次组，套进现成的分节显示（同 Antelope bus 节标题：
 * 淡色底、勾整节的框、每节 # 从 1 排、CSV 多一列 Section）。从早到晚排，没有时间的放最后一组 No time。
 * 组里的行照后端原来的先后（发过的在后）。别的标签、后端已经给了 sections 的，原样返回。
 */
export function withTicketSessions(page: ManifestPage): ManifestPage {
  if (page.tab !== "tickets" || page.sections?.length || !page.rows.length)
    return page;
  const groups = new Map<string, ManifestRow[]>();
  for (const r of page.rows) {
    const k = sessionKeyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === NO_TIME_KEY ? 1 : b === NO_TIME_KEY ? -1 : a.localeCompare(b),
  );
  const sections: ManifestListSection[] = keys.map((k) => {
    const rows = groups.get(k)!;
    const first = rows[0];
    const time = k === NO_TIME_KEY ? "" : sessionTime(first.values.start_time);
    const product = String(first.values.product ?? first.product_code ?? "");
    return {
      key: k,
      title: k === NO_TIME_KEY ? "No time" : `${time} — ${product}`,
      short_title: k === NO_TIME_KEY ? "No time" : time,
      kind: k === NO_TIME_KEY ? "no_time" : "session",
      rows: rows.length,
      orders: new Set(rows.map((r) => r.order_number)).size,
      pax: rows.reduce((n, r) => n + paxOf(r), 0),
      breakdown: sumBreakdown(rows),
    };
  });
  return {
    ...page,
    sections,
    rows: keys.flatMap((k) =>
      groups.get(k)!.map((r) => ({ ...r, section: k })),
    ),
  };
}

/**
 * Bus / Admin fee 的「By order time」看法（Annie 2026-11-21 第 5 件「其他问题全部同意推荐，动手」，
 * 样稿 https://claude.ai/artifact/6FwfiTd9yQ6T3oTTfqZdBM 题 2 A）：节照旧（后端给的节和节的先后不动），
 * 每节里按下单时间（booked_at）早的在前，没有的排最后；一样的照原来（接客时间）的先后；同一单的几行挨在一起。
 * 藏起来的行（hidden.rows）同样排。Tickets 不走这里（它有自己的两种看法）。只排显示，不改数据。
 */
export function withBookedOrder(page: ManifestPage): ManifestPage {
  if (page.tab === "tickets") return page;
  return {
    ...page,
    rows: sortByBooked(page.rows, (r) => r.section ?? ""),
    ...(page.hidden
      ? { hidden: { ...page.hidden, rows: sortByBooked(page.hidden.rows, () => "") } }
      : {}),
  };
}

function sortByBooked<
  R extends { order_number: string; booked_at?: string | null },
>(rows: readonly R[], sectionOf: (r: R) => string): R[] {
  const sectionAt = new Map<string, number>();
  const orderAt = new Map<string, number>();
  const orderBooked = new Map<string, string>();
  rows.forEach((r, i) => {
    const sec = sectionOf(r);
    if (!sectionAt.has(sec)) sectionAt.set(sec, i);
    const k = `${sec} ${r.order_number}`;
    if (!orderAt.has(k)) orderAt.set(k, i);
    if (r.booked_at && !orderBooked.has(k)) orderBooked.set(k, r.booked_at);
  });
  return rows
    .map((r, i) => {
      const sec = sectionOf(r);
      const k = `${sec} ${r.order_number}`;
      return {
        r,
        i,
        sec: sectionAt.get(sec)!,
        booked: orderBooked.get(k) ?? "",
        first: orderAt.get(k)!,
      };
    })
    .sort(
      (a, b) =>
        a.sec - b.sec ||
        (a.booked === b.booked
          ? 0
          : !a.booked
            ? 1
            : !b.booked
              ? -1
              : a.booked < b.booked
                ? -1
                : 1) ||
        a.first - b.first ||
        a.i - b.i,
    )
    .map((x) => x.r);
}

/**
 * 节标题行的底色（后端说颜色前端自定）：去程 / 回程的 shuttle 一个颜色；团按节的先后轮流
 * （同 Annie 看过的样稿：紫 / 绿 / 粉）。
 */
const TOUR_SECTION_BG = ["#efe3f7", "#e2f2da", "#fbe3eb", "#e3eef6"];
export function sectionBg(kind: string, tourIndex: number): string {
  // Tickets 场次组头一律浅灰（Annie 2026-11-19「同意推荐，动手」1A，取代 153 的轮流上色）；No time 组同色。Bus 团节照旧轮流。
  if (kind === "session" || kind === "no_time") return "#eceff3";
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
