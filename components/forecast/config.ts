import type {
  ForecastCrewLine,
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
 * CCL「Forecast 2026」表里、ops 还没有数据的行（Annie 2026-10-13：「全部保留它的表格，做好了我们再加其他板块的时候才知道数据从哪里来」）。
 * 先照 CCL 的位置和名字占好行、格子空着；以后接上数据（staff 在 ops 填，或从 CCL Discord 读，还没定）再填。
 * 哪块有哪些行按块名认（CCL 表就是按团分的）：名字里有 antelope / sunset / private。
 * - before：粗体人数行上面；afterSub：分项下面、Driver / Guide 上面；afterCrew：Driver / Guide 下面。
 */
export type CclExtraRows = {
  before: string[];
  afterSub: string[];
  afterCrew: string[];
};

/** 每块 Driver / Guide 下面的两行（CCL：一行人员备注，例 Scarlett N/A、GIA RX OFF；一行 NOTES / 订了几辆车，例 Glenn Confirmed）。 */
const CCL_CREW_NOTES = ["Crew notes", "Notes / Number of vehicles booked"];

export function cclExtraRows(blockName: string): CclExtraRows {
  const name = blockName.toLowerCase();
  if (name.includes("private")) {
    return {
      before: ["CCL major events"],
      afterSub: [],
      afterCrew: [
        "Private tours (CHD#, pax, tour, pick-up place & time)",
        "Pax (tour 1, tour 2)",
        "Driver / Vehicle type",
      ],
    };
  }
  if (name.includes("sunset")) {
    return { before: ["Sunset depart times"], afterSub: [], afterCrew: [] };
  }
  if (name.includes("antelope")) {
    return {
      before: ["Lower or Upper inventory (ref only)"],
      afterSub: ["Max allotments"],
      afterCrew: CCL_CREW_NOTES,
    };
  }
  return { before: [], afterSub: [], afterCrew: CCL_CREW_NOTES };
}
