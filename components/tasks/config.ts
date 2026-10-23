import { LA_TIME_ZONE } from "@/lib/la-date";
import type { DailyTask, TaskPriority } from "@/types";

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

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60000);
}

/** 截止时间状态 + 给人看的文字，纯前端算（任务包阶段三「一小时内到期标黄，超时标红」）。 */
export function dueStatus(task: DailyTask, now: string): { status: DueStatus; text: string } {
  if (task.done) {
    return { status: "done", text: "Done" };
  }
  if (!task.due_at) {
    const prefix = task.frequency === "hourly" ? "Every hour" : null;
    return {
      status: "none",
      text: prefix ? `${prefix}${task.due_note ? ` · ${task.due_note}` : ""}` : task.due_note || "No due time",
    };
  }
  const minutes = minutesBetween(task.due_at, now);
  const clock = formatClock(task.due_at);
  const prefix = task.frequency === "hourly" ? "Every hour · next by " : "";
  if (minutes < 0) {
    return { status: "overdue", text: `Overdue · was due ${clock}` };
  }
  if (minutes <= DUE_SOON_MINUTES) {
    return {
      status: "due_soon",
      text: minutes === 0 ? `Due now · ${clock}` : `Due in ${minutes} min · ${clock}`,
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
export function summarizeDone(tasks: DailyTask[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** 后端班次时间是 24 小时 "HH:MM"：13:30 → "1:30 PM"（和别处的时间写法一致）。 */
export function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
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
