import type {
  ForecastAllotment,
  ForecastBlock,
  ForecastBlockCellKey,
  ForecastCellMeta,
  ForecastCrewLine,
  ForecastDayAllotmentMeta,
  ForecastRunningMeta,
  ForecastPageCellKey,
  ForecastRow,
  ForecastVehicleTier,
} from "@/types";

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

const LONG_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "2026-10-12" → "Mon 10/12"（表头：星期缩写 + M/D，照设计稿）。按 UTC 解析再按 UTC 格式化，不会偏一天。 */
export function formatHeaderDay(ymd: string): string {
  const date = parseYmd(ymd);
  const weekday = WEEKDAY_FORMAT.format(date);
  const [, m, d] = ymd.split("-").map(Number);
  return `${weekday} ${m}/${d}`;
}

/** "2026-10-12" → "Mon, Oct 12, 2026"（编辑框、ccl_other 分组标题用）。 */
export function formatLongDate(ymd: string): string {
  return LONG_FORMAT.format(parseYmd(ymd));
}

/** 字符串形式的 YYYY-MM-DD 可以直接按字典序比较。 */
export function isPastDay(ymd: string, today: string): boolean {
  return ymd < today;
}

/**
 * 这一天这块不开团（Annie 2026-10-14：不开团的日子标「-」不标 0，一眼分清没开团和没卖）。
 * G63 起后端给 `running`（Products 设的每周不开 / 停开日期 + CCL Discord 的 Closed）；没有这个字段时只认 CCL 的 Closed。
 */
export function isClosedDay(block: ForecastBlock, dayIndex: number): boolean {
  if (block.running?.[dayIndex] === false) return true;
  const crew = block.crew[dayIndex];
  return crew?.source === "ccl" && crew.closed;
}

/** 不开团的原因（鼠标移上去看）：后端的 closed_reason 优先，其次 CCL 的话；开团是 ""。 */
export function closedReason(block: ForecastBlock, dayIndex: number): string {
  const reason = block.closed_reason?.[dayIndex];
  if (reason) return reason;
  const crew = block.crew[dayIndex];
  if (crew?.source === "ccl" && crew.closed)
    return crew.closed_note || "Closed";
  return "";
}

/** 格子里显示的数：不开团且是 0 ⇒「-」；不开团却卖了（不该有）照样显示数字，不藏人数。 */
export function cellValue(value: number, closed: boolean): string {
  return closed && value === 0 ? "-" : String(value);
}

export function isAllZero(values: readonly number[]): boolean {
  return values.every((v) => v === 0);
}

function sameValues(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 块只有一行、且这行和粗体那行完全一样时，那一行是纯重复，不画——同 CCL 的表：VOF 两块只有总数，
 * Hoover / Antelope / B&Z 这些有几个分项的才列（Annie 2026-10-13 给的 CCL 截图；99deeed 一度全列，按截图改回）。
 * 接口契约：「If a block has exactly one row and that row's values equal total exactly, don't render the sub-row」。
 */
export function visibleSubRows(
  rows: readonly ForecastRow[],
  total: readonly number[],
  hideZero: boolean,
): ForecastRow[] {
  if (rows.length === 1 && sameValues(rows[0].values, total)) {
    return [];
  }
  return hideZero ? rows.filter((r) => !isAllZero(r.values)) : [...rows];
}

/**
 * 单独成块的节（block.section 非空）→ 它所属主块的名字。
 * 后端拼法是 `${display_name} · ${section}`（见 forecast.py build_blocks()），这里原样反过来切，
 * 不用另外请求主块数据——同一个块自己的 name/section 就够算。
 */
export function mainRouteName(name: string, section: string): string {
  if (!section) return name;
  const suffix = ` · ${section}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** CCL 行没有 readable（或是空字符串）时的兜底拼法，用接口给的其余字段。 */
export function composeReadableLine(line: ForecastCrewLine): string {
  // 接口契约写的是 string | null，但真实数据里见过非字符串的值（如布尔），
  // 先判类型再 trim，不然这类行会直接把整页炸掉（2026-10-09 真机验收发现）。
  if (typeof line.readable === "string" && line.readable.trim()) {
    return line.readable.trim();
  }
  const parts: string[] = [];
  if (line.bus_label) parts.push(`Bus ${line.bus_label}`);
  if (line.driver) {
    parts.push(line.is_driver_guide ? `${line.driver} (D+G)` : line.driver);
  }
  if (!line.is_driver_guide && line.guide) parts.push(line.guide);
  if (line.vehicle) parts.push(line.vehicle);
  if (line.route) parts.push(line.route);
  const main = parts.join(" · ") || line.raw || "(unreadable line)";
  return line.note ? `${main} — ${line.note}` : main;
}

/** 这一档的展示色：已知的四个名字（后端阈值已定）调出在深色底上读得清楚的配色；没见过的名字按字面色兜底。 */
export interface TierSwatch {
  bg: string;
  text: string;
  border: string;
}

// Annie 2026-10-12：红、绿饱和度太高，改成柔和的（她在预览里选的那版）；Sprinter 改黄色——后端把设置
// `forecast_vehicle_tiers` 里 Sprinter 的 black 改成 yellow 以后生效（见 PROGRESS「需要后端」），black 先留着原样。
const KNOWN_SWATCHES: Record<string, TierSwatch> = {
  black: { bg: "#1e293b", text: "#f8fafc", border: "rgba(255,255,255,.14)" },
  yellow: { bg: "#cbbb84", text: "#1c1917", border: "rgba(255,255,255,.14)" },
  green: { bg: "#64877a", text: "#f1f5f2", border: "rgba(255,255,255,.14)" },
  white: { bg: "#e6ebf0", text: "#1c1917", border: "#d6d3d1" },
  red: { bg: "#9e6b6b", text: "#fbf1f1", border: "rgba(255,255,255,.14)" },
};

/** 没见过的档位颜色名：直接当 CSS 颜色用，再按常见的浅色名猜一个读得清的字色。 */
function fallbackSwatch(color: string): TierSwatch {
  const light = /^(white|yellow|cream|beige|silver|lightgray|lightgrey)$/i.test(
    color.trim(),
  );
  return {
    bg: color,
    text: light ? "#1c1917" : "#f8fafc",
    border: light ? "#d6d3d1" : "rgba(255,255,255,.14)",
  };
}

export function tierSwatch(color: string): TierSwatch {
  return KNOWN_SWATCHES[color.toLowerCase().trim()] ?? fallbackSwatch(color);
}

/**
 * 上色规则（接口契约）：总数为 0 一律不上色；否则取第一个 `total <= max` 的档，
 * 最后一档 max: null 兜底「比前面都高」。空数组按「不上色」处理（调用方应先判断 tiers.length）。
 */
export function tierForTotal(
  total: number,
  tiers: readonly ForecastVehicleTier[],
): ForecastVehicleTier | null {
  if (total <= 0) return null;
  for (const tier of tiers) {
    if (tier.max === null || total <= tier.max) return tier;
  }
  return null;
}

/**
 * CCL「Forecast 2026」表里粗体行 / 分项 / Driver·Guide 以外的行（Annie 2026-10-13：「全部保留它的表格」）。
 * G63（2026-10-15）起大多有了数据：
 * - cell：staff 手写（Annie：「除非我已经做了拉取或同步，其他的都可以手写」）；page：整页一行的手写格（CCL major events）；
 * - depart：Rezdy 出发时间（Sunset）；orders：逐单列订单（Products 勾了 List each order 的块）；
 * - allotments：每档剩几位 / 上限（Products 设上限）；placeholder：还空着（Notes 行，Annie 自己设计）。
 * 哪块有哪些行按块名认（CCL 表就是按团分的）：名字里有 antelope / sunset / private。
 * 「Lower or Upper inventory (ref only)」那行去掉了（Annie 2026-10-15：剩几位跟上限放在一起，18/30）。
 * - before：粗体人数行上面；afterSub：分项下面、Driver / Guide 上面；afterCrew：Driver / Guide 下面。
 */
export type CclExtraRow =
  | { kind: "cell"; key: ForecastBlockCellKey; label: string }
  | { kind: "page"; key: ForecastPageCellKey; label: string }
  | { kind: "depart"; label: string }
  | { kind: "orders"; label: string }
  | { kind: "allotments"; label: string }
  | { kind: "placeholder"; label: string };

export type CclExtraRows = {
  before: CclExtraRow[];
  afterSub: CclExtraRow[];
  afterCrew: CclExtraRow[];
};

const CREW_NOTES: CclExtraRow = {
  kind: "cell",
  key: "crew_notes",
  label: "Crew notes",
};
/** CCL 的 NOTES（Annie 2026-10-16：行名只留 Notes，不写 Number of vehicles booked）/ 订了几辆车（例 Glenn Confirmed）：Annie 要用来表示导游 confirmed，她回头自己设计，先空着。 */
const NOTES: CclExtraRow = {
  kind: "placeholder",
  label: "Notes",
};
const ALLOTMENTS: CclExtraRow = { kind: "allotments", label: "Max allotments" };
const ORDERS: CclExtraRow = {
  kind: "orders",
  label: "Private tours (CHD#, pax, tour, pick-up place & time)",
};

export function cclExtraRows(block: ForecastBlock): CclExtraRows {
  const name = block.name.toLowerCase();
  const hasAllotments = Boolean(block.allotments?.length);
  if (name.includes("private")) {
    return {
      before: [
        { kind: "page", key: "major_events", label: "CCL major events" },
      ],
      afterSub: hasAllotments ? [ALLOTMENTS] : [],
      afterCrew: [
        ORDERS,
        { kind: "cell", key: "pax_tours", label: "Pax (tour 1, tour 2)" },
        { kind: "cell", key: "driver_vehicle", label: "Driver / Vehicle type" },
      ],
    };
  }
  // Antelope 没设上限也留着 Max allotments 这行（CCL 表上有）；别的块设了上限才有。
  const afterSub =
    hasAllotments || name.includes("antelope") ? [ALLOTMENTS] : [];
  const afterCrew = block.orders ? [ORDERS] : [];
  if (name.includes("sunset")) {
    return {
      before: [{ kind: "depart", label: "Sunset depart times" }],
      afterSub,
      afterCrew: [...afterCrew, CREW_NOTES],
    };
  }
  return { before: [], afterSub, afterCrew: [...afterCrew, CREW_NOTES, NOTES] };
}

/**
 * 每档的简称（Annie 2026-10-15：三个羚羊谷都用第一个字母大写 ⇒ U / L / X）：行名第一个字母大写；
 * 同一块里两档首字母撞了，那几档写全名，免得分不清。
 */
export function allotmentAbbreviations(
  allotments: readonly ForecastAllotment[],
): Map<string, string> {
  const first = (label: string) => label.trim().charAt(0).toUpperCase();
  const counts = new Map<string, number>();
  for (const a of allotments) {
    const f = first(a.label);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return new Map(
    allotments.map((a) => {
      const f = first(a.label);
      return [a.label, f && counts.get(f) === 1 ? f : a.label];
    }),
  );
}

/** 这一天这一档的上限 / 时间和平常不一样（Products 里按日期段另设了）⇒ 格子里补上当天的上限和时间。 */
export function allotmentDiffersOn(
  a: ForecastAllotment,
  dayIndex: number,
): boolean {
  const max = a.max[dayIndex];
  if (max === null || max === undefined) return false;
  return (
    max !== a.normal_max || (a.time[dayIndex] ?? "") !== (a.normal_time ?? "")
  );
}

/** 这一天这块有没有要写的上限（列宽要放到能放下三行）。不开团的日子不写。 */
export function hasAllotmentOn(
  block: ForecastBlock,
  dayIndex: number,
): boolean {
  if (isClosedDay(block, dayIndex)) return false;
  return Boolean(
    block.allotments?.some(
      (a) => a.max[dayIndex] !== null && a.max[dayIndex] !== undefined,
    ),
  );
}

const META_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

/** 「Oct 15, 8:02 AM」（洛杉矶时间）。读不出的时间原样写。 */
export function formatMetaTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : META_FORMAT.format(at);
}

/** 「by Veronica, Oct 15, 8:02 AM」（手写格鼠标移上去看）。 */
export function describeMeta(
  meta: Pick<ForecastCellMeta, "updated_by" | "updated_at"> | null | undefined,
): string {
  if (!meta) return "";
  return `by ${meta.updated_by}, ${formatMetaTime(meta.updated_at)}`;
}

/** 小黄点的提示（开关团）：「Not running - Canyon closed · by Veronica, Oct 15, 8:02 AM」。 */
export function describeRunningMeta(meta: ForecastRunningMeta): string {
  const what = meta.running
    ? "Running"
    : meta.reason
      ? `Not running - ${meta.reason}`
      : "Not running";
  return `${what} · ${describeMeta(meta)}`;
}

/** 小黄点的提示（上限）：「30 @ 1p · by Veronica, Oct 15, 8:02 AM」。 */
export function describeAllotmentMeta(meta: ForecastDayAllotmentMeta): string {
  return `${meta.max}${meta.time ? ` @ ${meta.time}` : ""} · ${describeMeta(meta)}`;
}
