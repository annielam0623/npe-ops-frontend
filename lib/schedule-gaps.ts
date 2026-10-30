import { formatClock, minutesOf } from "@/lib/schedule-time";
import type { ScheduleGap, ScheduleShiftType, ScheduleSlot } from "@/types";

/**
 * 排班空档的显示（Annie 2026-10-29「你要提醒是哪一天有问题，而不是让人去找问题在哪里」，preview
 * https://claude.ai/artifact/CJaXdFkBS5S4g97gjtxuD8 ，「Q1-5 同意推荐，动手」）。
 * 空档一律用后端 `ScheduleWeek.gaps`（整周、按工作时段算好的），前端只负责写清楚是哪天哪段。
 */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11-07" → "Sat 11/07"。 */
export function gapDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[wd]} ${date.slice(5).replace("-", "/")}`;
}

/** 一段空档：「2:00–8:00 AM」；跨上下午写全「11:00 AM–1:00 PM」。 */
export function gapRange(g: ScheduleGap): string {
  const a = formatClock(g.start_time);
  const b = formatClock(g.end_time);
  const [ah, ap] = a.split(" ");
  const [bh, bp] = b.split(" ");
  return ap === bp ? `${ah}–${bh} ${bp}` : `${a}–${b}`;
}

/** 周表列头用的短写：「2–8 AM」（整点去掉 :00）。 */
export function gapRangeShort(g: ScheduleGap): string {
  return gapRange(g).replace(/:00/g, "");
}

/** 按日期分组，日期先后排好。 */
export function gapsByDate(gaps: ScheduleGap[]): Map<string, ScheduleGap[]> {
  const out = new Map<string, ScheduleGap[]>();
  for (const g of [...gaps].sort(
    (x, y) =>
      x.date.localeCompare(y.date) || x.start_time.localeCompare(y.start_time),
  )) {
    const list = out.get(g.date) ?? [];
    list.push(g);
    out.set(g.date, list);
  }
  return out;
}

/**
 * 为什么这段没人：这一天在 Unassigned、时间和空档重叠的班（例「2 Open shifts at 3:00 AM are Unassigned」）；
 * 没有就是这段根本没排班。
 */
export function gapReason(
  g: ScheduleGap,
  slots: ScheduleSlot[],
  shiftTypes: ScheduleShiftType[],
): string {
  const gs = minutesOf(g.start_time) ?? 0;
  const ge = minutesOf(g.end_time) ?? 0;
  const open = slots.filter((s) => {
    if (s.date !== g.date || s.employee_id != null) return false;
    const ss = minutesOf(s.start_time);
    const se = minutesOf(s.end_time);
    return ss != null && se != null && ss < ge && se > gs;
  });
  if (!open.length) return "no shift covers this time";
  const groups = new Map<string, number>();
  for (const s of open) {
    const label =
      shiftTypes.find((t) => t.key === s.shift_type)?.label ?? s.shift_type;
    const key = `${label} shift|${formatClock(s.start_time)}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const parts = [...groups].map(([key, n]) => {
    const [what, at] = key.split("|");
    return `${n === 1 ? "1" : n} ${what}${n === 1 ? "" : "s"} at ${at}`;
  });
  return `${parts.join(", ")} ${open.length === 1 ? "is" : "are"} Unassigned`;
}
