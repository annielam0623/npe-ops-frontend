/**
 * 每个人最近排过的班（班次 + 上下班时间），存在这台浏览器里，给「加班」窗口当快捷选项
 * （例如 Anita 的 Mid 8:00 AM – 5:00 PM 只用输入一次）。只是每个人自己的小方便，丢了也行，所以包在 try / catch 里。
 */
export interface RecentShift {
  type: string;
  start: string;
  end: string;
}

const MAX_RECENT = 8;
const keyOf = (employeeId: number) => `npe_sch_recent_${employeeId}`;

export function readRecentShifts(employeeId: number): RecentShift[] {
  try {
    const raw = window.localStorage.getItem(keyOf(employeeId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentShift =>
        !!r &&
        typeof r.type === "string" &&
        typeof r.start === "string" &&
        typeof r.end === "string",
    );
  } catch {
    return [];
  }
}

export function pushRecentShift(employeeId: number, shift: RecentShift): void {
  try {
    const next = [
      shift,
      ...readRecentShifts(employeeId).filter(
        (r) =>
          !(
            r.type === shift.type &&
            r.start === shift.start &&
            r.end === shift.end
          ),
      ),
    ].slice(0, MAX_RECENT);
    window.localStorage.setItem(keyOf(employeeId), JSON.stringify(next));
  } catch {
    // 存不了就算了
  }
}
