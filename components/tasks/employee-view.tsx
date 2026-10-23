"use client";

import { useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTaskDone } from "@/lib/tasks-api";
import { cn } from "@/lib/utils";
import type { DailyTask, TasksToday } from "@/types";

import {
  dueStatus,
  formatClock,
  formatHHMM,
  summarizeDone,
  summarizeUrgent,
} from "./config";
import { PassOverDialog } from "./pass-over-dialog";
import { DueTag, LinkOpen, PassOverNote, PriorityDot } from "./shared";

const COPY_HIDDEN_KEY = "ops.myTasks.copyHidden";

export function EmployeeTasks({
  data,
  onChanged,
  onUnauthorized,
}: {
  data: TasksToday;
  onChanged: (task: DailyTask) => void;
  onUnauthorized: () => void;
}) {
  // 待接受的交接不在这里：它们在旁边的 Notice 面板里 Accept，接受后才进下面的清单（Annie 2026-10-19）。
  const { me, tasks, now, shifts } = data;
  const myShift = shifts.find((s) => s.username === me.username);
  const [copyHidden, setCopyHidden] = useState(false);
  // 说明文字可收起（收起键在右边），记在本机浏览器里；读不到就当展开。
  useEffect(() => {
    try {
      setCopyHidden(localStorage.getItem(COPY_HIDDEN_KEY) === "1");
    } catch {}
  }, []);
  function toggleCopy() {
    setCopyHidden((hidden) => {
      try {
        localStorage.setItem(COPY_HIDDEN_KEY, hidden ? "0" : "1");
      } catch {}
      return !hidden;
    });
  }
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [passOverTarget, setPassOverTarget] = useState<DailyTask | null>(null);
  const [error, setError] = useState("");

  const { done, total } = summarizeDone(tasks);
  const { overdue, dueSoon } = summarizeUrgent(tasks, now);

  async function toggle(task: DailyTask) {
    if (togglingId !== null) return;
    setTogglingId(task.id);
    setError("");
    try {
      const updated = await toggleTaskDone(task.id, !task.done);
      onChanged(updated);
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      else setError(describeError(err));
    } finally {
      setTogglingId(null);
    }
  }

  const nextTitle = myShift?.next_display_name ?? "the next shift";

  return (
    <section
      aria-label="My tasks"
      className="db-section mb-[18px] rounded-[16px] border border-white/[.14] p-[18px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="db-title flex items-center gap-2 text-[15px]">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-[#3b82f6] shadow-[0_0_0_3px_rgba(59,130,246,.3),0_0_12px_-1px_#3b82f6]"
          />
          My tasks{me.shift_start ? ` · ${formatHHMM(me.shift_start)}–${me.shift_end ? formatHHMM(me.shift_end) : ""}` : ""} · now {formatClock(now)}
        </h2>
        <span className="flex items-baseline gap-3.5">
          <span className="text-[12.5px] font-semibold text-white/80 tabular-nums">
            {done} of {total} done
          </span>
          <button
            type="button"
            onClick={toggleCopy}
            aria-expanded={!copyHidden}
            aria-controls="my-tasks-copy"
            className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
          >
            {copyHidden ? "Show" : "Hide"}
            <span
              aria-hidden
              className={cn("inline-block transition-transform", copyHidden && "-rotate-90")}
            >
              ⌄
            </span>
          </button>
        </span>
      </div>
      <div id="my-tasks-copy" hidden={copyHidden}>
        <p className="mt-1 text-[12.5px] text-white/80">
          Fixed, time-based tasks for this shift — not your whole workload.
          Guest replies, Tracking, Orders and the rest aren&rsquo;t tracked
          here.
        </p>
        <p className="mt-1 text-[12.5px] text-white/80">
          Finish these before your shift ends. Anything left must be passed to{" "}
          {nextTitle} and accepted.
        </p>
      </div>

      {overdue > 0 || dueSoon > 0 ? (
        <p className="mt-3.5 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.03] px-3.5 py-2 text-[13px] font-semibold">
          🔔{" "}
          {[
            overdue > 0 ? `${overdue} overdue` : null,
            dueSoon > 0 ? `${dueSoon} due within the hour` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}

      {tasks.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-[13px] text-white/40">
          Nothing assigned to you yet today.
        </p>
      ) : (
        <ul className="mt-3.5 flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              now={now}
              me={me.username}
              busy={togglingId === task.id}
              onToggle={() => void toggle(task)}
              onPassOver={() => setPassOverTarget(task)}
            />
          ))}
        </ul>
      )}

      {passOverTarget ? (
        <PassOverDialog
          task={passOverTarget}
          nextDisplayName={myShift?.next_display_name ?? null}
          onDismiss={() => setPassOverTarget(null)}
          onPassedOver={(updated) => {
            onChanged(updated);
            setPassOverTarget(null);
          }}
        />
      ) : null}
    </section>
  );
}

function TaskRow({
  task,
  now,
  me,
  busy,
  onToggle,
  onPassOver,
}: {
  task: DailyTask;
  now: string;
  me: string;
  busy: boolean;
  onToggle: () => void;
  onPassOver: () => void;
}) {
  // 我自己交出去、还没被接受的：灰掉，不能再勾 / 再交一次。
  const pendingMine =
    task.pass_over !== null &&
    !task.pass_over.accepted_at &&
    task.pass_over.from_username === me;
  const { status } = dueStatus(task, now);

  return (
    <li
      data-task-id={task.id}
      data-due-status={status}
      className={cn(
        "db-emboss flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border px-3.5 py-2.5",
        task.done
          ? "border-white/[.08] opacity-70"
          : status === "overdue"
            ? "border-[#f87171]/40 bg-[#f87171]/[.05]"
            : "border-white/[.14]",
      )}
    >
      <input
        type="checkbox"
        aria-label={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        checked={task.done}
        disabled={busy || pendingMine}
        onChange={onToggle}
        className="mt-[3px] size-[15px] shrink-0 accent-[#38bdf8] disabled:opacity-50"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[13.5px] font-semibold",
            task.done && "text-white/40 line-through",
          )}
        >
          {task.title}
        </p>
        {task.link_href && task.link_label ? (
          <div className="mt-0.5">
            <LinkOpen href={task.link_href} label={task.link_label} />
          </div>
        ) : null}
        <PassOverNote task={task} />
      </div>
      <PriorityDot task={task} />
      <DueTag task={task} now={now} />
      {!task.done && !pendingMine ? (
        <button
          type="button"
          onClick={onPassOver}
          disabled={busy}
          className="shrink-0 rounded-lg border border-white/15 px-3 py-1 text-[12px] font-semibold text-white/70 hover:border-white/30 hover:text-white disabled:opacity-60"
        >
          Pass over
        </button>
      ) : null}
    </li>
  );
}
