"use client";

import { useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTaskDone, updateTaskDue } from "@/lib/tasks-api";
import { cn } from "@/lib/utils";
import type { DailyTask, StaffShiftToday, TasksToday } from "@/types";

import { AddTaskRow } from "./add-task-row";
import { PeriodCards } from "./period-cards";
import {
  formatClock,
  formatHHMM,
  laWallClockToIso,
  summarizeDone,
  toLaHHMM,
} from "./config";
import { LinkOpen, PriorityDot } from "./shared";

export function SupervisorTasks({
  data,
  onChanged,
  onUnauthorized,
}: {
  data: TasksToday;
  onChanged: (task: DailyTask) => void;
  onUnauthorized: () => void;
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
      className="db-section mb-[18px] rounded-[16px] border border-white/[.14] p-[18px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="db-title text-[15px]">
          Today’s tasks · all shifts · now {formatClock(now)}{" "}
          <span className="font-semibold text-white/55">
            · {done} of {total} done
          </span>
        </h2>
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
        <div className="mt-3.5 rounded-lg border border-white/10 bg-white/[.025] p-3">
          <p className="text-[11px] font-bold tracking-[.04em] text-white/50 uppercase">
            Pass-over notifications · each one is also emailed to you
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {pass_over_notices.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]"
              >
                <span>
                  <span
                    aria-hidden
                    className={cn(
                      "mr-1.5 inline-block size-[6px] rounded-full align-middle",
                      n.accepted ? "bg-[#4ade80]" : "bg-[#fbbf24]",
                    )}
                  />
                  {n.from_display_name} passed “{n.task_title}” to{" "}
                  {n.to_display_name}
                  {n.accepted ? " — accepted" : " — waiting for accept"}
                </span>
                <span className="text-white/40 tabular-nums">
                  {formatClock(n.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Anytime 一条在上，下面左边 AM 卡、右边 PM 卡（Annie 2026-10-24）；每张卡里再按人分小标题。 */}
      <div className="mt-4">
        <PeriodCards
          tasks={tasks}
          renderBody={(list) => (
            <PeopleLists
              tasks={list}
              shifts={shifts}
              busyId={busyId}
              onToggle={toggle}
              onChangeDue={changeDue}
            />
          )}
        />
      </div>

      <AddTaskRow date={date} shifts={shifts} onAdded={onChanged} />
    </section>
  );
}

/** 一张卡里的任务：没指定人的（全班共用）一小组 “All shift”，指定了人的按人各一小组，每组带班次时间和进度。 */
function PeopleLists({
  tasks,
  shifts,
  busyId,
  onToggle,
  onChangeDue,
}: {
  tasks: DailyTask[];
  shifts: StaffShiftToday[];
  busyId: number | null;
  onToggle: (task: DailyTask) => void;
  onChangeDue: (task: DailyTask, hhmm: string) => void;
}) {
  const groups = new Map<string | null, DailyTask[]>();
  groups.set(null, []);
  for (const task of tasks) {
    const key = task.assigned_to_username;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(task);
  }
  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([username, groupTasks]) =>
        groupTasks.length === 0 ? null : (
          <PersonList
            key={username ?? "all-shift"}
            username={username}
            displayName={groupTasks[0].assigned_to_display_name}
            tasks={groupTasks}
            shifts={shifts}
            busyId={busyId}
            onToggle={onToggle}
            onChangeDue={onChangeDue}
          />
        ),
      )}
    </div>
  );
}

function PersonList({
  username,
  displayName,
  tasks,
  shifts,
  busyId,
  onToggle,
  onChangeDue,
}: {
  username: string | null;
  displayName: string | null;
  tasks: DailyTask[];
  shifts: StaffShiftToday[];
  busyId: number | null;
  onToggle: (task: DailyTask) => void;
  onChangeDue: (task: DailyTask, hhmm: string) => void;
}) {
  const person = username ? shifts.find((s) => s.username === username) : null;
  const { done, total } = summarizeDone(tasks);

  return (
    <div data-person={username ?? "all-shift"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-white/20 bg-white/[.04] px-2 py-0.5 text-[10.5px] font-bold tracking-[.06em] text-white/60 uppercase">
          {username ? (displayName ?? username) : "All shift"}
        </span>
        {person ? (
          <span className="text-[13px] font-semibold text-white/45">
            {formatHHMM(person.shift_start)}–{formatHHMM(person.shift_end)}
          </span>
        ) : null}
        <span className="ml-auto text-[12px] font-semibold text-white/45 tabular-nums">
          {done} of {total} done
        </span>
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-y-1.5">
        {tasks.map((task) => (
          <SupervisorTaskRow
            key={task.id}
            task={task}
            busy={busyId === task.id}
            onToggle={() => onToggle(task)}
            onChangeDue={(hhmm) => onChangeDue(task, hhmm)}
          />
        ))}
      </ul>
    </div>
  );
}

function SupervisorTaskRow({
  task,
  busy,
  onToggle,
  onChangeDue,
}: {
  task: DailyTask;
  busy: boolean;
  onToggle: () => void;
  onChangeDue: (hhmm: string) => void;
}) {
  const pendingAccept = task.pass_over !== null && !task.pass_over.accepted_at;

  return (
    <li className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-white/[.015] px-2.5 py-2">
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
        {task.assigned_to_display_name ? (
          <span className="shrink-0 text-[11px] text-white/40">
            {task.assigned_to_display_name}
          </span>
        ) : null}
        {/* Anytime 卡里的任务：没有截止时间写 When free 之类，每小时重复的写 Every hour（preview 第 2 版）。 */}
        {task.frequency === "hourly" || (!task.due_at && task.due_note) ? (
          <span className="shrink-0 text-[11.5px] text-white/50">
            {task.frequency === "hourly" ? "Every hour" : task.due_note}
          </span>
        ) : null}
        <input
          type="time"
          aria-label={`Finish-by time for ${task.title}`}
          value={task.due_at ? toLaHHMM(task.due_at) : ""}
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
