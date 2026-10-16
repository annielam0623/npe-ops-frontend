/** "HH:MM" → 当天第几分钟；非法输入给 null，调用方决定怎么处理。 */
export function minutesOf(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "HH:MM" → "9:30 AM"（没有前导零，同站内其它页面的时间显示）。 */
export function formatClock(hhmm: string | null): string {
  const mins = minutesOf(hhmm);
  if (mins == null) return "—";
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${formatClock(start)} – ${formatClock(end)}`;
}

/** 下班时间不晚于上班时间（含相等）：Off 之外的格子需要标黄提示（任务包「下班时间不晚于上班时间的格子标黄」）。 */
export function hasBadTimeRange(
  start: string | null,
  end: string | null,
): boolean {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s == null || e == null) return false;
  return e <= s;
}
