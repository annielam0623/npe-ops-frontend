"use client";

import { useState } from "react";

import type { BlockGate } from "@/components/dashboard/widget-gates";
import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTaskDone, updateTaskDue } from "@/lib/tasks-api";
import { cn } from "@/lib/utils";
import type { DailyTask, TaskPassOverNotice, TasksToday } from "@/types";

import { AddTaskRow } from "./add-task-row";
import {
  dayLabel,
  dueStatus,
  effectiveDueAt,
  formatClock,
  laWallClockToIso,
  summarizeDone,
  toLaHHMM,
} from "./config";
import { DayTag, DueTag, LinkOpen, PriorityDot } from "./shared";
import { TaskTimeline } from "./timeline";

const DAY_MS = 24 * 3600 * 1000;

export function SupervisorTasks({
  data,
  onChanged,
  onUnauthorized,
  gate,
}: {
  data: TasksToday;
  onChanged: (task: DailyTask) => void;
  onUnauthorized: () => void;
  /** Super Admin 的「员工可见」开关（标题行右侧）；关着时黄色虚线框。 */
  gate?: BlockGate;
}) {
  const { tasks, shifts, now, date, pass_over_notices } = data;
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const { done, total } = summarizeDone(tasks);

  async function toggle(task: DailyTask) {
    if (busyId !== null) return;
    setBusyId(task.id);
    setError("");
    try {
      onChanged(await toggleTaskDone(task.id, !task.done));
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      else setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function changeDue(task: DailyTask, hhmm: string) {
    setBusyId(task.id);
    setError("");
    try {
      onChanged(
        await updateTaskDue(
          task.id,
          hhmm ? laWallClockToIso(date, hhmm) : null,
        ),
      );
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      else setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      aria-label="Today's tasks"
      data-staff-hidden={gate?.hiddenFromStaff || undefined}
      className={cn(
        "db-section mb-[18px] rounded-[16px] border p-[18px]",
        gate?.hiddenFromStaff
          ? "border-dashed border-[#fbbf24]/50"
          : "border-white/[.14]",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="db-title text-[15px]">
          Today’s tasks · all shifts{" "}
          <span className="font-semibold text-white/55">
            · {done} of {total} done
          </span>
        </h2>
        {gate?.staffSwitch ? (
          <span className="self-center">{gate.staffSwitch}</span>
        ) : null}
      </div>
      <p className="mt-1 text-[12.5px] text-white/55">
        Fixed, time-based tasks for the shift — not everyone&rsquo;s whole
        workload. Guest replies, Tracking, Orders and the rest aren&rsquo;t
        tracked here.
      </p>
      <p className="mt-1 text-[12.5px] text-white/55">
        Each task shows for whoever is on shift during its time window.
        Finish-by times are defaults — change any of them below. You are
        notified every time a task is passed over.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}

      {pass_over_notices && pass_over_notices.length > 0 ? (
        <Handovers notices={pass_over_notices} date={date} now={now} />
      ) : null}

      {/* 和员工一样的一列时间线（G202）：排全天、不分段、一次露 3 条，每条写是谁的，Finish-by 框照旧能改。 */}
      <div className="mt-4">
        <TaskTimeline
          tasks={tasks}
          now={now}
          renderRow={(task) => (
            <SupervisorTaskRow
              key={task.id}
              task={task}
              now={now}
              busy={busyId === task.id}
              onToggle={() => void toggle(task)}
              onChangeDue={(hhmm) => void changeDue(task, hhmm)}
            />
          )}
        />
      </div>

      <AddTaskRow date={date} shifts={shifts} onAdded={onChanged} />
    </section>
  );
}

/**
 * 交接（G202 preview 第 3 版「Handovers」）：最近 24 小时的，加上更早还没 Done 的（后端 B5）；
 * 前一天的标 YESTERDAY，带交出人设的完成时间（B4）。后端没带这些字段时照旧显示谁交给谁、接没接。
 */
function Handovers({
  notices,
  date,
  now,
}: {
  notices: TaskPassOverNotice[];
  date: string;
  now: string;
}) {
  const nowMs = new Date(now).getTime();
  return (
    <div
      data-handovers
      className="mt-3.5 rounded-xl border border-white/[.14] bg-white/[.02] px-3.5 py-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-white/[.12] pb-2">
        <h3 className="text-[13.5px] font-bold tracking-[.03em]">Handovers</h3>
        <span className="text-[11.5px] text-white/45">
          last 24 hours, plus older ones not done yet · each one is also emailed
          to you
        </span>
        <span className="ml-auto text-[12px] font-semibold text-white/55 tabular-nums">
          {notices.length} {notices.length === 1 ? "handover" : "handovers"}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {notices.map((n) => {
          const day = dayLabel(n.at, date);
          const workDay =
            n.work_date && n.work_date < date
              ? dayLabel(`${n.work_date}T20:00:00Z`, date)
              : null;
          const tag = workDay ?? day;
          const older = nowMs - new Date(n.at).getTime() > DAY_MS;
          const status = !n.accepted
            ? "waiting for accept"
            : n.done === true
              ? "accepted, done"
              : n.done === false
                ? "accepted, not done"
                : "accepted";
          return (
            <li
              key={n.id}
              data-handover={n.id}
              className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[12.5px]"
            >
              <span>
                <span
                  aria-hidden
                  className={cn(
                    "mr-1.5 inline-block size-[6px] rounded-full align-middle",
                    n.accepted ? "bg-[#4ade80]" : "bg-[#fbbf24]",
                  )}
                />
                {tag ? <DayTag label={tag} /> : null}
                {n.from_display_name} passed “{n.task_title}” to{" "}
                {n.to_display_name}
                {n.finish_by
                  ? ` · finish by ${whenText(n.finish_by, date)}`
                  : ""}
                {` — ${status}`}
                {older ? (
                  <span className="text-white/40"> · older than 24 h</span>
                ) : null}
              </span>
              <span className="text-white/40 tabular-nums">
                {whenText(n.at, date)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 今天 / 昨天的只写钟点（昨天的有 YESTERDAY 标签），更早的写 "Oct 25 · 8:10 PM"。 */
function whenText(iso: string, date: string): string {
  const day = dayLabel(iso, date);
  return day && day !== "Yesterday"
    ? `${day} · ${formatClock(iso)}`
    : formatClock(iso);
}

function SupervisorTaskRow({
  task,
  now,
  busy,
  onToggle,
  onChangeDue,
}: {
  task: DailyTask;
  now: string;
  busy: boolean;
  onToggle: () => void;
  onChangeDue: (hhmm: string) => void;
}) {
  const pendingAccept = task.pass_over !== null && !task.pass_over.accepted_at;
  const { status } = dueStatus(task, now);
  const dueAt = effectiveDueAt(task);

  return (
    <li
      data-task-id={task.id}
      data-due-status={status}
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border px-2.5 py-2",
        task.done
          ? "border-white/5 bg-white/[.015] opacity-70"
          : status === "overdue"
            ? "border-[#f87171]/40 bg-[#f87171]/[.05]"
            : "border-white/5 bg-white/[.015]",
      )}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label={
            task.done
              ? `Mark ${task.title} not done`
              : `Mark ${task.title} done`
          }
          checked={task.done}
          disabled={busy || pendingAccept}
          onChange={onToggle}
          className="size-[14px] shrink-0 accent-[#38bdf8] disabled:opacity-50"
        />
        <PriorityDot task={task} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12.5px] font-medium",
            task.done && "text-white/40 line-through",
          )}
          title={task.title}
        >
          {task.title}
        </span>
        <span data-task-who className="shrink-0 text-[11px] text-white/40">
          {task.assigned_to_display_name ?? "All shift"}
        </span>
        {status === "overdue" ? <DueTag task={task} now={now} /> : null}
        {/* Anytime 卡里的任务：没有截止时间写 When free 之类，每小时重复的写 Every hour（preview 第 2 版）。 */}
        {task.frequency === "hourly" || (!dueAt && task.due_note) ? (
          <span className="shrink-0 text-[11.5px] text-white/50">
            {task.frequency === "hourly" ? "Every hour" : task.due_note}
          </span>
        ) : null}
        <input
          type="time"
          aria-label={`Finish-by time for ${task.title}`}
          value={dueAt ? toLaHHMM(dueAt) : ""}
          disabled={busy || pendingAccept}
          onChange={(event) => onChangeDue(event.target.value)}
          className="w-[108px] shrink-0 rounded-md border border-white/15 bg-white/[.04] px-1.5 py-0.5 text-[11.5px] text-white [color-scheme:dark] outline-none focus:border-[#185FA5] disabled:opacity-50"
        />
      </div>
      {task.link_href && task.link_label ? (
        <div className="pl-[22px]">
          <LinkOpen href={task.link_href} label={task.link_label} />
        </div>
      ) : null}
      {pendingAccept ? (
        <p className="pl-[22px] text-[11px] font-semibold text-[#fbbf24]">
          Passing to {task.pass_over?.to_display_name} — not accepted yet
        </p>
      ) : null}
    </li>
  );
}
