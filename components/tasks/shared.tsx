import { cn } from "@/lib/utils";
import type { DailyTask } from "@/types";

import {
  dayLabel,
  dueStatus,
  formatClock,
  PRIORITY_DOT_CLASS,
  PRIORITY_LABEL,
  STATUS_PILL_CLASS,
} from "./config";

export function PriorityDot({ task }: { task: DailyTask }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[7px] shrink-0 rounded-full",
        PRIORITY_DOT_CLASS[task.priority],
      )}
      title={PRIORITY_LABEL[task.priority]}
    />
  );
}

export function DueTag({ task, now }: { task: DailyTask; now: string }) {
  const { status, text } = dueStatus(task, now);
  return (
    <span
      data-due-status={status}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums",
        STATUS_PILL_CLASS[status],
      )}
    >
      {text}
    </span>
  );
}

/** 前一天交过来的交接：标题前一个 YESTERDAY 小标签（preview 第 3 版）。 */
export function YesterdayTag({
  task,
  date,
}: {
  task: DailyTask;
  date: string;
}) {
  const po = task.pass_over;
  const label = po?.accepted_at ? dayLabel(po.at, date) : null;
  return label ? <DayTag label={label} /> : null;
}

export function DayTag({ label }: { label: string }) {
  return (
    <span className="mr-1.5 inline-block rounded border border-white/[.28] px-[5px] align-[1px] text-[10px] font-bold tracking-[.06em] text-white/70 uppercase">
      {label}
    </span>
  );
}

/** 接受交接后：显示来自谁、什么时候交的、说明（任务包第 21 条「保留在当天清单里」）。 */
export function PassOverNote({
  task,
  date,
}: {
  task: DailyTask;
  date: string;
}) {
  const po = task.pass_over;
  if (!po) return null;
  const day = dayLabel(po.at, date);
  return (
    <p className="mt-1 text-[11.5px] text-white/45">
      {po.accepted_at ? (
        <>
          From {po.from_display_name} · {formatClock(po.at)}
          {day ? ` ${day === "Yesterday" ? "yesterday" : day}` : ""} ·{" "}
          {po.note || "No note"}
        </>
      ) : (
        <>Waiting for {po.to_display_name} to accept</>
      )}
    </p>
  );
}

export function LinkOpen({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="text-[12px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
    >
      Open {label} →
    </a>
  );
}
