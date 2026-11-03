import { formatClock } from "@/lib/schedule-time";
import type { ScheduleSettings, ScheduleWorkHoursDay } from "@/types";

/**
 * Working hours 按星期几（Annie 2026-11-02「我要在working hour里可以选择一周的时间，也可以分别设置几天的时间不同」，
 * preview 97MgNcpw28p7W4DxXmpgrM ⑦⑧⑨ A；后端 v144：GET /api/settings/schedule 的 work_hours）。
 * 空档、Day timeline、页面那行只读字都从这里取「这一天」的时间；后端没带 work_hours（旧版）时每天都用 work_window。
 */

/** 某一天要查空档的时段；off = 这天不查（No coverage needed）。 */
export interface DayHours {
  start_time: string;
  end_time: string;
  off: boolean;
}

export type HoursOf = (date: string) => DayHours;

export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export const WEEKDAY_SHORT = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/** "YYYY-MM-DD" → 0 = Mon … 6 = Sun（同后端 weekday()）。 */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** 7 天（按 weekday 排）；旧后端没有 work_hours 时 7 天都是 work_window。 */
export function weekDays(settings: ScheduleSettings): DayHours[] {
  const ww = settings.work_window;
  const byDay = new Map<number, ScheduleWorkHoursDay>(
    (settings.work_hours?.days ?? []).map((d) => [d.weekday, d]),
  );
  return WEEKDAY_NAMES.map((_, i) => {
    const d = byDay.get(i);
    return {
      start_time: d?.start_time ?? ww.start_time,
      end_time: d?.end_time ?? ww.end_time,
      off: d?.off ?? false,
    };
  });
}

/** 七天时间都一样、没有不查的那天。 */
export function sameEveryDay(settings: ScheduleSettings): boolean {
  if (settings.work_hours) return settings.work_hours.same_every_day;
  return true;
}

export function hoursOfSettings(settings: ScheduleSettings): HoursOf {
  const days = weekDays(settings);
  return (date) => days[weekdayOf(date)];
}

/**
 * 页面上那行只读字：七天一样写「2:00 AM – 9:30 PM」；不一样按连着的几天合并，
 * 例如「Mon–Fri 2:00 AM – 9:30 PM · Sat–Sun 4:00 AM – 9:00 PM」，不查的那几天写「Sun no coverage needed」。
 */
export function workHoursSummary(settings: ScheduleSettings): string {
  const days = weekDays(settings);
  const text = (d: DayHours) =>
    d.off
      ? "no coverage needed"
      : `${formatClock(d.start_time)} – ${formatClock(d.end_time)}`;
  if (sameEveryDay(settings) && !days.some((d) => d.off)) return text(days[0]);
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && text(days[j + 1]) === text(days[i])) j++;
    const name =
      i === j ? WEEKDAY_SHORT[i] : `${WEEKDAY_SHORT[i]}–${WEEKDAY_SHORT[j]}`;
    parts.push(`${name} ${text(days[i])}`);
    i = j + 1;
  }
  return parts.join(" · ");
}
