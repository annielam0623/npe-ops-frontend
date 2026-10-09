import type { ForecastCrewLine, ForecastRow, ForecastVehicleTier } from "@/types";

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
 * 块只有一行、且这行和 Total 完全一样时，那一行是纯重复（同一份数据画两遍），不画。
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

/** CCL 行没有 readable（或是空字符串）时的兜底拼法，用接口给的其余字段。 */
export function composeReadableLine(line: ForecastCrewLine): string {
  if (line.readable && line.readable.trim()) {
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

const KNOWN_SWATCHES: Record<string, TierSwatch> = {
  black: { bg: "#1e293b", text: "#f8fafc", border: "rgba(255,255,255,.14)" },
  green: { bg: "#15803d", text: "#f0fdf4", border: "rgba(255,255,255,.14)" },
  white: { bg: "#f8fafc", text: "#1c1917", border: "#d6d3d1" },
  red: { bg: "#b91c1c", text: "#fef2f2", border: "rgba(255,255,255,.14)" },
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
