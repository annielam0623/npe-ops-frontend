import type { ScheduleGap, ScheduleViolation } from "@/types";

/**
 * 过去的问题不再提醒（Annie 2026-11-27「过去的周有任何问题都不要再来做现在的限制或提醒了，因为已经过去了」
 * 「这些都是以前的了，还标红不让我存做什么」「动手」）：「过去」= 早于今天（洛杉矶），只管显示，保存 / 发布照旧。
 * 后端 86 在源头做同一个口径（rule_violations 去掉日期全在今天以前的；gaps 本来就只算以后，schedule.py:806）。
 * 这里是后端上线前的保险，口径一样，后端上线后照样无害。
 */

/** 违规：有一天是今天或以后就留（跨天的「昨天 Close + 今天早班」要留）；没有日期的照旧留。 */
export function notPastViolations<T extends ScheduleViolation>(
  violations: readonly T[],
  today: string,
): T[] {
  return violations.filter((v) => {
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
