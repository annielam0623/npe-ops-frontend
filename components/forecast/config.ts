import type { ForecastDay } from "@/types";

const LONG_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "2026-10-08" → "Thu, Oct 8, 2026"。按 UTC 解析再按 UTC 格式化，不会偏一天。 */
export function formatLong(ymd: string): string {
  return LONG_FORMAT.format(parseYmd(ymd));
}

/** "2026-10-08" → "Oct 8"（图表坐标轴用）。 */
export function formatShort(ymd: string): string {
  return SHORT_FORMAT.format(parseYmd(ymd));
}

/** "2026-10-08" → "Thu"（表格 / CSV 的星期列）。 */
export function formatWeekday(ymd: string): string {
  return WEEKDAY_FORMAT.format(parseYmd(ymd));
}

export interface ForecastStats {
  total: number;
  average: number;
  peakIndex: number;
}

/** 接口永远返回 30 条、今天是第 0 条，所以这里不用另外判断「今天是哪条」。 */
export function summarize(days: ForecastDay[]): ForecastStats {
  if (!days.length) {
    return { total: 0, average: 0, peakIndex: -1 };
  }
  let total = 0;
  let peakIndex = 0;
  days.forEach((day, i) => {
    total += day.pax;
    if (day.pax > days[peakIndex].pax) {
      peakIndex = i;
    }
  });
  return { total, average: Math.round(total / days.length), peakIndex };
}

/** 把最大值往上取整到一个干净的刻度（1 / 2 / 5 × 10^n），给图表 Y 轴用。 */
export function niceMax(rawMax: number): number {
  if (rawMax <= 0) {
    return 10;
  }
  const exponent = Math.floor(Math.log10(rawMax));
  const fraction = rawMax / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}
