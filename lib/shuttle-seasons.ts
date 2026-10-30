import { shiftYmd } from "@/lib/la-date";
import type { ShuttleSeason } from "@/types";

/**
 * Shuttle 站接人时间的季节（Annie 2026-10-29：「Q8，有季节，会按时间段分出来」；v3 Q12 A 全站共用）。
 * 日期都是 "YYYY-MM-DD"，起止都含当天；字符串比较就是日期先后。
 */

export function sortSeasons<T extends { starts_on: string }>(
  seasons: T[],
): T[] {
  return [...seasons].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

/** 这一天属于哪一季；没有 = null（不重叠时最多一个）。 */
export function seasonOn<T extends ShuttleSeason>(
  date: string,
  seasons: T[],
): T | null {
  return seasons.find((s) => s.starts_on <= date && date <= s.ends_on) ?? null;
}

/** 两两重叠的季节（一天只能属于一季）。 */
export function seasonOverlaps<
  T extends { name: string; starts_on: string; ends_on: string },
>(seasons: T[]): { a: T; b: T; from: string; to: string }[] {
  const out: { a: T; b: T; from: string; to: string }[] = [];
  const list = sortSeasons(seasons);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (b.starts_on <= a.ends_on) {
        out.push({
          a,
          b,
          from: b.starts_on,
          to: a.ends_on < b.ends_on ? a.ends_on : b.ends_on,
        });
      }
    }
  }
  return out;
}

/**
 * 从 from 起 days 天里没有季节的日子（连成段）。季节之间的空档、最后一季之后还没接上的都算。
 * 只看往后（过去的空档没有意义）。
 */
export function uncoveredRanges(
  seasons: { starts_on: string; ends_on: string }[],
  from: string,
  days: number,
): { from: string; to: string }[] {
  const until = shiftYmd(from, days - 1);
  const out: { from: string; to: string }[] = [];
  let cursor = from;
  for (const s of sortSeasons(seasons)) {
    if (s.ends_on < cursor) continue;
    if (s.starts_on > until) break;
    if (s.starts_on > cursor)
      out.push({ from: cursor, to: shiftYmd(s.starts_on, -1) });
    cursor = shiftYmd(s.ends_on, 1);
    if (cursor > until) return out;
  }
  if (cursor <= until) out.push({ from: cursor, to: until });
  return out;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-03-08" → "Mar 8, 2026"。 */
export function formatSeasonDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** 季节键下面的小字：同一年「Mar 8 – Nov 1, 2026」，跨年写全。 */
export function formatSeasonRange(s: {
  starts_on: string;
  ends_on: string;
}): string {
  const a = formatSeasonDate(s.starts_on);
  const b = formatSeasonDate(s.ends_on);
  return s.starts_on.slice(0, 4) === s.ends_on.slice(0, 4)
    ? `${a.replace(/, \d{4}$/, "")} – ${b}`
    : `${a} – ${b}`;
}

/** Copy to next year：日期加一年，名字里的年份也加一（「Winter 2026–27」→「Winter 2027–28」）。 */
export function nextYearSeason(s: {
  name: string;
  starts_on: string;
  ends_on: string;
}): {
  name: string;
  starts_on: string;
  ends_on: string;
} {
  const plus = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    // 2 月 29 日没有下一年的同一天：退到 28 日。
    const day = m === 2 && d === 29 ? 28 : d;
    return `${y + 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const name = s.name
    .replace(
      /(\d{4})([–-])(\d{2})\b/,
      (_, y: string, dash: string, yy: string) =>
        `${Number(y) + 1}${dash}${String((Number(yy) + 1) % 100).padStart(2, "0")}`,
    )
    .replace(/\b(\d{4})\b(?![–-]\d)/, (_, y: string) => String(Number(y) + 1));
  return { name, starts_on: plus(s.starts_on), ends_on: plus(s.ends_on) };
}
