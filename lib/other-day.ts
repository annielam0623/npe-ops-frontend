import { laToday } from "./la-date";

/**
 * 135：Dispatch 当天的发送，要发的日子不是今天（洛杉矶）时先确认（Annie 2026-11-13，后端 54 转，风险方案 B）。
 * 起因：11-13 凌晨 1:53 登录，Dispatch 开的是 11-14，31 个 relay 客人和 11-14 的司机消息提前一天发了。
 * 后端 14 同时让这些接口在不是今天时拒发，除非带对得上的 `confirm_date`（暂定字段名）。
 */

/**
 * 洛杉矶今天（YYYY-MM-DD）。检查脚本可以设 window.__laToday = "YYYY-MM-DD" 固定成某一天
 * （同 schedule-view 的 window.__scheduleNow）；staff 一律按真的今天。
 */
export function sendToday(now: Date = new Date()): string {
  const fixed =
    typeof window !== "undefined"
      ? (window as unknown as { __laToday?: unknown }).__laToday
      : undefined;
  return typeof fixed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fixed)
    ? fixed
    : laToday(now);
}

/** 要发的日子不是洛杉矶今天 ⇒ 返回这个日子（YYYY-MM-DD）；是今天 / 没日子 ⇒ null。点的那一刻算，不在渲染时算（页面可能开过半夜）。 */
export function otherDayOf(
  date: string | null | undefined,
  now: Date = new Date(),
): string | null {
  return date && date !== sendToday(now) ? date : null;
}

/** 请求体里的日期确认：不是今天才带（staff 在确认框点了 Yes 才走到发送）。 */
export function confirmDateField(
  date: string,
  now: Date = new Date(),
): { confirm_date?: string } {
  const d = otherDayOf(date, now);
  return d ? { confirm_date: d } : {};
}

/** "Sat, Nov 14"（YYYY-MM-DD 按日历日读，不经时区换算）。 */
export function otherDayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
