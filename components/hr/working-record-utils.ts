import { LA_TIME_ZONE, shiftYmd, weekStartYmd } from "@/lib/la-date";
import type {
  FieldCalendarDay,
  FieldCalendarPerson,
  FieldHours,
  FieldRole,
  FieldRun,
} from "@/types/hr-working-record";

import type { ProfileSection } from "./fields";

/**
 * Working Record（置顶 86）的纯逻辑：格子文字、合计、Export 的行。没有 React，方便单独核。
 */

export const ROLE_LABEL: Record<FieldRole, string> = {
  driver: "Driver",
  guide: "Guide",
  both: "Driver & Guide",
};

/** relay 两轮靠 shift 分（Dispatch 的 relay / relay_2）。 */
export function roundLabel(run: Pick<FieldRun, "shift">): string | null {
  if (run.shift === "relay") return "1st round";
  if (run.shift === "relay_2") return "2nd round";
  return null;
}

/** 段名：title（没有就用团名），relay 加轮次。合计「By tour」也用它。 */
export function runTitle(run: FieldRun): string {
  const base = (run.title || run.tour_name || "").trim();
  const round = roundLabel(run);
  if (!base) return round ?? "";
  return round ? `${base} · ${round}` : base;
}

export function hasText(value: string | null | undefined): value is string {
  return !!value && value.trim() !== "";
}

/** 周表一列：周日开始的七天。 */
export function weekDays(anyDay: string): string[] {
  const start = weekStartYmd(anyDay);
  return Array.from({ length: 7 }, (_, i) => shiftYmd(start, i));
}

/** 这个月的第一天 / 最后一天。 */
export function monthRange(anyDay: string): { from: string; to: string } {
  const from = `${anyDay.slice(0, 8)}01`;
  const [y, m] = from.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${from.slice(0, 8)}${String(last).padStart(2, "0")}` };
}

/** 月历 / 按月叠的周表：从这个月 1 号那一周的周日，到最后一天那一周的周六（最多 42 天，≤ 93）。 */
export function monthGrid(anyDay: string): string[][] {
  const { from, to } = monthRange(anyDay);
  const weeks: string[][] = [];
  for (
    let start = weekStartYmd(from);
    start <= to;
    start = shiftYmd(start, 7)
  ) {
    weeks.push(weekDays(start));
  }
  return weeks;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "numeric",
  day: "numeric",
});
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const RANGE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "numeric",
  day: "numeric",
});

function utc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Sun 11/1" */
export function dayHeader(ymd: string): string {
  return WEEKDAY_FORMAT.format(utc(ymd)).replace(",", "");
}

/** "November 2026" */
export function monthTitle(ymd: string): string {
  return MONTH_FORMAT.format(utc(ymd));
}

/** "Sun 11/1 – Sat 11/7, 2026" */
export function weekTitle(days: string[]): string {
  const first = RANGE_FORMAT.format(utc(days[0])).replace(",", "");
  const last = RANGE_FORMAT.format(utc(days[days.length - 1])).replace(",", "");
  return `${first} – ${last}, ${days[days.length - 1].slice(0, 4)}`;
}

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** "4:26 AM"（洛杉矶）；没有 / 读不懂为 null。 */
export function clock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : CLOCK_FORMAT.format(t);
}

/** 上下班都有才算得出钟点数（保留 2 位小数）；缺一头 = null。 */
export function hoursOf(h: FieldHours | null | undefined): number | null {
  if (!h?.start_at || !h.end_at) return null;
  const ms = new Date(h.end_at).getTime() - new Date(h.start_at).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

export function formatHours(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} h`;
}

/** Samsara 不全（fallback：下班按 23:00 兜底，或连上班时间都没有）：要人核对后再算工资。 */
export function hoursNeedCheck(h: FieldHours | null | undefined): boolean {
  return h?.source === "fallback";
}

/** 后端的 note 原文；fallback 没写 note 时按缺哪头补一句（同后端两句）。 */
export function hoursNote(h: FieldHours): string | null {
  if (hasText(h.note)) return h.note;
  if (h.source === "fallback") {
    return h.start_at ? "No Samsara off-duty time" : "No Samsara time";
  }
  return null;
}

/** 格子 / 弹窗 / Export 里的一行钟点："4:26 AM – 6:59 PM · 14.55 h"；起点没有写 "? – 11:00 PM"。 */
export function hoursLine(h: FieldHours): string | null {
  const start = clock(h.start_at);
  const end = clock(h.end_at);
  if (!start && !end) return null;
  const n = hoursOf(h);
  return `${start ?? "?"} – ${end ?? "?"}${n !== null ? ` · ${formatHours(n)}` : ""}`;
}

export interface PersonTotals {
  days: Record<FieldRole, number>;
  /** 各段几次（一天两段各记 1 次），按次数多到少、再按名字。 */
  byTour: Array<{ title: string; count: number }>;
  /** 算得出钟点的天数合计。 */
  hours: number;
  hoursDays: number;
  /** Samsara 不全、要核对的天。 */
  needCheck: number;
  /** 还没存档（live）的天。 */
  liveDays: number;
}

/** 合计：只算 [from, to] 里的天（月历前后补的格子不算）。 */
export function totalsOf(
  days: FieldCalendarDay[],
  from: string,
  to: string,
): PersonTotals {
  const out: PersonTotals = {
    days: { driver: 0, guide: 0, both: 0 },
    byTour: [],
    hours: 0,
    hoursDays: 0,
    needCheck: 0,
    liveDays: 0,
  };
  const tours = new Map<string, number>();
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    out.days[d.role] += 1;
    if (d.source === "live") out.liveDays += 1;
    for (const r of d.runs) {
      const t = runTitle(r) || "No tour name";
      tours.set(t, (tours.get(t) ?? 0) + 1);
    }
    const n = hoursOf(d.hours);
    if (n !== null) {
      out.hours += n;
      out.hoursDays += 1;
    }
    if (hoursNeedCheck(d.hours)) out.needCheck += 1;
  }
  out.hours = Math.round(out.hours * 100) / 100;
  out.byTour = [...tours]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  return out;
}

/** 分节同 Profile（fields.ts profileSection）；Position not set 的说明换成这里能用的一句（这里不能改 Position）。 */
export const WORK_SECTIONS: readonly {
  key: ProfileSection;
  title: string;
  note: string;
}[] = [
  { key: "drivers", title: "Drivers", note: "Driver and Driver + Guide" },
  { key: "guides", title: "Guides", note: "Guide only" },
  {
    key: "unset",
    title: "Position not set",
    note: "Set the position in Profile",
  },
];

export const EXPORT_HEADERS = [
  "Name",
  "Date",
  "Role",
  "Tours",
  "Vans",
  "Start",
  "End",
  "Hours",
  "Hours from",
  "Hours note",
  "Saved",
] as const;

const HOURS_FROM: Record<FieldHours["source"], string> = {
  samsara: "Samsara",
  fallback: "Samsara + 11:00 PM",
  schedule: "Tour times",
  none: "",
};

/** ⬇ Export for payroll：每人每天一行 + 每人一行合计（[from, to] 里的天）。 */
export function exportRows(
  people: FieldCalendarPerson[],
  from: string,
  to: string,
): unknown[][] {
  const rows: unknown[][] = [];
  for (const p of people) {
    const days = p.days
      .filter((d) => d.date >= from && d.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) continue;
    for (const d of days) {
      const h = d.hours ?? null;
      const n = hoursOf(h);
      rows.push([
        p.name,
        d.date,
        ROLE_LABEL[d.role],
        d.runs.map((r) => runTitle(r) || "No tour name").join(" / "),
        d.runs.map((r) => (hasText(r.van) ? r.van : "No van")).join(" / "),
        clock(h?.start_at) ?? "",
        clock(h?.end_at) ?? "",
        n ?? "",
        h ? HOURS_FROM[h.source] : "",
        h ? (hoursNote(h) ?? "") : "",
        d.source === "live" ? "Not saved yet (live)" : "Saved",
      ]);
    }
    const t = totalsOf(days, from, to);
    rows.push([
      `${p.name} — total`,
      `${from} to ${to}`,
      `Driver ${t.days.driver} · Guide ${t.days.guide} · Driver & Guide ${t.days.both}`,
      t.byTour.map((x) => `${x.title} ×${x.count}`).join(" / "),
      "",
      "",
      "",
      t.hours,
      "",
      t.needCheck ? `${t.needCheck} day(s) to check` : "",
      t.liveDays ? `${t.liveDays} live day(s)` : "",
    ]);
  }
  return rows;
}
