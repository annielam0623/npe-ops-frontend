import type { ScheduleGap, ScheduleViolation } from "@/types";

/**
 * 过去的问题不再提醒（Annie 2026-11-27「过去的周有任何问题都不要再来做现在的限制或提醒了，因为已经过去了」
 * 「这些都是以前的了，还标红不让我存做什么」「动手」）：「过去」= 早于今天（洛杉矶），只管显示，保存 / 发布照旧。
 * 后端 86 在源头做同一个口径（rule_violations 去掉日期全在今天以前的；gaps 本来就只算以后，schedule.py:806）。
 * 这里是后端上线前的保险，口径一样，后端上线后照样无害。
 */

/** 违规：按周的看整周过完没有；其余有一天是今天或以后就留（跨天的「昨天 Close + 今天早班」要留）；没有日期的照旧留。 */
export function notPastViolations<T extends ScheduleViolation>(
  violations: readonly T[],
  today: string,
): T[] {
  return violations.filter((v) => {
    // 按周算的（带 week：天数上下限、days_per_week、每周小时）：整周过完（周六早于今天）才去掉，同后端 86。
    // 只有 dates = [那个周日] 的「不够天数」那种，按日期会把当前周的误藏。
    if (v.week) return addDays(v.week, 6) >= today;
    const dates = v.dates ?? [];
    return dates.length === 0 || dates.some((d) => d >= today);
  });
}

/** 空档：今天或以后的日子才留。 */
export function notPastGaps<T extends ScheduleGap>(
  gaps: readonly T[],
  today: string,
): T[] {
  return gaps.filter((g) => g.date >= today);
}

/** 请假：date_to 早于今天才算过去（跨过今天的照旧列）。 */
export function leaveNotPast<T extends { date_to: string }>(
  requests: readonly T[],
  today: string,
): T[] {
  return requests.filter((r) => r.date_to >= today);
}

/** 改班请求的日子：move / add 的 date，swap / move 的两张卡；取最晚那天。没有日期的照旧留。 */
function requestLastDate(r: {
  date: string | null;
  my_slot?: { date: string } | null;
  their_slot?: { date: string } | null;
}): string | null {
  const ds = [r.date, r.my_slot?.date, r.their_slot?.date].filter(
    (d): d is string => !!d,
  );
  return ds.length ? ds.sort().at(-1)! : null;
}

/**
 * 改班请求：日子全在今天以前的不列、不计数（Annie 2026-11-27「P1选A，动手」）。请求本身还在系统里。
 * 只滤还在走的（pending / awaiting_peer）；已决定 / 已关的照旧（那是记录，不是提醒）。
 */
export function requestsNotPast<
  T extends {
    status: string;
    date: string | null;
    my_slot?: { date: string } | null;
    their_slot?: { date: string } | null;
  },
>(requests: readonly T[], today: string): T[] {
  return requests.filter((r) => {
    if (r.status !== "pending" && r.status !== "awaiting_peer") return true;
    const d = requestLastDate(r);
    return !d || d >= today;
  });
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
