/** 业务上的「今天」「几点」一律按洛杉矶，不看浏览器所在时区。 */
export const LA_TIME_ZONE = "America/Los_Angeles";

const YMD_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const HOUR_MINUTE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 洛杉矶的今天，YYYY-MM-DD。 */
export function laToday(now: Date = new Date()): string {
  return YMD_FORMAT.format(now);
}

/** 洛杉矶当前是一天里的第几分钟（0–1439）。 */
export function laMinuteOfDay(now: Date = new Date()): number {
  const parts = HOUR_MINUTE_FORMAT.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** YYYY-MM-DD 加减天数（按日历日，不受时区 / 夏令时影响）。 */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function isYmd(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return shiftYmd(value, 0) === value;
}

/** 这一周的第一天（周日，同旧后台 Send Log 的 This Week），YYYY-MM-DD。 */
export function weekStartYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return shiftYmd(ymd, -weekday);
}

/** 这个月的 1 号，YYYY-MM-DD。 */
export function monthStartYmd(ymd: string): string {
  return `${ymd.slice(0, 8)}01`;
}
