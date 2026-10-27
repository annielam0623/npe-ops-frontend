import { LA_TIME_ZONE } from "@/lib/la-date";
import type { DailyTask, StaffShiftToday, TaskPriority } from "@/types";

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: "HIGH",
  moderate: "MODERATE",
  low: "LOW",
};

/** 一小时内到期标黄、超时标红（任务包阶段三「员工视角」）。 */
const DUE_SOON_MINUTES = 60;

export type DueStatus = "done" | "overdue" | "due_soon" | "normal" | "none";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** "4:00 PM" 这样的洛杉矶时间，同预览里的写法。 */
export function formatClock(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/**
 * 这条任务按哪个时间排、算超时（G202）：接受了的交接按交出人设的 Finish by（`pass_over.finish_by`），
 * 其余按 `due_at`。后端没带 finish_by 时就是 `due_at`，页面照常。
 */
export function effectiveDueAt(task: DailyTask): string | null {
  const po = task.pass_over;
  if (po?.accepted_at && po.finish_by) return po.finish_by;
  return task.due_at;
}

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60000);
}

/** 截止时间状态 + 给人看的文字，纯前端算（任务包阶段三「一小时内到期标黄，超时标红」）。 */
export function dueStatus(
  task: DailyTask,
  now: string,
): { status: DueStatus; text: string } {
  if (task.done) {
    return { status: "done", text: "Done" };
  }
  const dueAt = effectiveDueAt(task);
  if (!dueAt) {
    const prefix = task.frequency === "hourly" ? "Every hour" : null;
    return {
      status: "none",
      text: prefix
        ? `${prefix}${task.due_note ? ` · ${task.due_note}` : ""}`
        : task.due_note || "No due time",
    };
  }
  const minutes = minutesBetween(dueAt, now);
  const clock = formatClock(dueAt);
  const prefix = task.frequency === "hourly" ? "Every hour · next by " : "";
  if (minutes < 0) {
    return { status: "overdue", text: `Overdue · was due ${clock}` };
  }
  if (minutes <= DUE_SOON_MINUTES) {
    return {
      status: "due_soon",
      text:
        minutes === 0
          ? `Due now · ${clock}`
          : `Due in ${minutes} min · ${clock}`,
    };
  }
  return { status: "normal", text: `${prefix}By ${clock}` };
}

export const STATUS_TEXT_CLASS: Record<DueStatus, string> = {
  done: "text-white/35 line-through",
  overdue: "text-[#f87171]",
  due_soon: "text-[#fbbf24]",
  normal: "text-white/55",
  none: "text-white/55",
};

export const STATUS_PILL_CLASS: Record<DueStatus, string> = {
  done: "border-white/10 bg-white/[.04] text-white/40",
  overdue: "border-[#f87171]/40 bg-[#f87171]/[.12] text-[#f87171]",
  due_soon: "border-[#fbbf24]/40 bg-[#fbbf24]/[.12] text-[#fbbf24]",
  normal: "border-white/15 bg-white/[.04] text-white/55",
  none: "border-white/15 bg-white/[.04] text-white/55",
};

export const PRIORITY_DOT_CLASS: Record<TaskPriority, string> = {
  high: "bg-[#f87171]",
  moderate: "bg-[#fbbf24]",
  low: "bg-white/30",
};

/** 「N of M done」汇总，供员工 / 主管两个标题行用。 */
export function summarizeDone(tasks: DailyTask[]): {
  done: number;
  total: number;
} {
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** 后端班次时间是 24 小时 "HH:MM"：13:30 → "1:30 PM"（和别处的时间写法一致）。 */
export function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** 没有截止时间的（All shift / When free）和每小时重复的（next-by 一直在变）不排进时间线，单放 Anytime。 */
export function isAnytime(task: DailyTask): boolean {
  return !effectiveDueAt(task) || task.frequency === "hourly";
}

/** 按截止时间从早到晚排（没有截止时间的排后面，同时间按 id）。 */
export function sortByDue(tasks: DailyTask[]): DailyTask[] {
  const at = (t: DailyTask) => {
    const due = effectiveDueAt(t);
    return due ? new Date(due).getTime() : Infinity;
  };
  return [...tasks].sort((a, b) => {
    const ad = at(a);
    const bd = at(b);
    return ad === bd ? a.id - b.id : ad < bd ? -1 : 1;
  });
}

export interface TimelineParts {
  /** 没有截止时间 / 每小时重复。 */
  any: DailyTask[];
  /** 过了时间还没做（置顶、标红）。 */
  overdue: DailyTask[];
  /** 过了时间、做完了（收成一行 Earlier today）。 */
  earlier: DailyTask[];
  /** 其余按截止时间排成一列（时间线本身）。 */
  rest: DailyTask[];
}

/**
 * 任务时间线（G202，Annie 2026-10-27 preview 第 3 版）：不分 AM / PM，按截止时间排成一列；
 * Anytime、Overdue、Earlier today 单独放，不算在时间线一次露的那 3 条里。
 */
export function splitTimeline(tasks: DailyTask[], now: string): TimelineParts {
  const nowMs = new Date(now).getTime();
  const parts: TimelineParts = { any: [], overdue: [], earlier: [], rest: [] };
  for (const task of sortByDue(tasks)) {
    if (isAnytime(task)) {
      parts.any.push(task);
      continue;
    }
    const past = new Date(effectiveDueAt(task) as string).getTime() < nowMs;
    if (past && !task.done) parts.overdue.push(task);
    else if (past) parts.earlier.push(task);
    else parts.rest.push(task);
  }
  return parts;
}

/** 一小时内到期 + 超时的条数，顶部汇总用（任务包阶段三「员工视角」）。 */
export function summarizeUrgent(tasks: DailyTask[], now: string) {
  let overdue = 0;
  let dueSoon = 0;
  for (const t of tasks) {
    const { status } = dueStatus(t, now);
    if (status === "overdue") overdue++;
    else if (status === "due_soon") dueSoon++;
  }
  return { overdue, dueSoon };
}

function laOffsetMinutes(utcMs: number): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIME_ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value;
  const match = part ? /GMT([+-]\d+)/.exec(part) : null;
  return match ? Number(match[1]) * 60 : -480;
}

/** 这天 + 洛杉矶墙钟时间（"HH:MM"）拼成 ISO，供改截止时间的 <input type="time"> 用。 */
export function laWallClockToIso(dateYmd: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const offset = laOffsetMinutes(new Date(`${dateYmd}T12:00:00Z`).getTime());
  const utcMs =
    Date.UTC(
      Number(dateYmd.slice(0, 4)),
      Number(dateYmd.slice(5, 7)) - 1,
      Number(dateYmd.slice(8, 10)),
      h,
      m,
    ) -
    offset * 60000;
  return new Date(utcMs).toISOString();
}

const HHMM_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO → "HH:MM"（24 小时，洛杉矶墙钟），给 <input type="time"> 的 value 用。 */
export function toLaHHMM(iso: string): string {
  return HHMM_FORMAT.format(new Date(iso));
}

const LA_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO → 洛杉矶日期 "YYYY-MM-DD"。 */
export function toLaYmd(iso: string): string {
  return LA_DATE_FORMAT.format(new Date(iso));
}

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
});

/** 前一天交出的交接（跨午夜）：今天的返回 null，昨天的 "Yesterday"，更早的 "Oct 25"。 */
export function dayLabel(iso: string, today: string): string | null {
  const ymd = toLaYmd(iso);
  if (ymd >= today) return null;
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return ymd === yesterday.toISOString().slice(0, 10)
    ? "Yesterday"
    : SHORT_DATE_FORMAT.format(new Date(iso));
}

/** Pass over 的接收人和他下一班的时间（Finish by 的默认值、可选范围）。 */
export interface PassOverReceiver {
  name: string | null;
  /** 24 小时 "HH:MM"；不知道就是 null。 */
  shiftStart: string | null;
  shiftEnd: string | null;
  /** 接收人那一班的日期（"YYYY-MM-DD"），Finish by 拼 ISO 用。 */
  workDate: string;
  /**
   * 后端 G202 是否已上线：`shifts[]` 带 `next_shift_start` 字段（B3）就当 B1（pass-over 收 finish_by）也在了。
   * 没上线时弹窗不出 Finish by、也不发这个字段。
   */
  finishByLive: boolean;
}

export function passOverReceiver(
  myShift: StaffShiftToday | undefined,
  shifts: StaffShiftToday[],
  date: string,
): PassOverReceiver {
  const finishByLive = !!myShift && "next_shift_start" in myShift;
  const name = myShift?.next_display_name ?? null;
  if (myShift?.next_shift_start) {
    return {
      name,
      shiftStart: myShift.next_shift_start,
      shiftEnd: myShift.next_shift_end ?? null,
      workDate: myShift.next_work_date ?? date,
      finishByLive,
    };
  }
  // 没有 B3 时，下一班的人今天也在班的话用今天的班次。
  const next = myShift?.next_username
    ? shifts.find((s) => s.username === myShift.next_username)
    : undefined;
  return {
    name,
    shiftStart: next?.shift_start ?? null,
    shiftEnd: next?.shift_end ?? null,
    workDate: date,
    finishByLive,
  };
}

/** Finish by 默认 = 接收人上班后 1 小时（不超过下班时间），Annie 对 v2 第 4 条。 */
export function defaultFinishBy(receiver: PassOverReceiver): string {
  const { shiftStart, shiftEnd } = receiver;
  if (!shiftStart) return "";
  const [h, m] = shiftStart.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  const plusHour = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return shiftEnd && shiftEnd > shiftStart && plusHour > shiftEnd
    ? shiftEnd
    : plusHour;
}
