"use client";

import { useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { acceptPassOver, toggleTaskDone } from "@/lib/tasks-api";
import { cn } from "@/lib/utils";
import type { DailyTask, TasksToday } from "@/types";

import {
  dueStatus,
  formatClock,
  ROLE_LABEL,
  summarizeDone,
  summarizeUrgent,
} from "./config";
import { PassOverDialog } from "./pass-over-dialog";
import { DueTag, LinkOpen, PassOverNote, PriorityDot } from "./shared";

export function EmployeeTasks({
  data,
  onChanged,
  onUnauthorized,
}: {
  data: TasksToday;
  onChanged: (task: DailyTask) => void;
  onUnauthorized: () => void;
}) {
  const { me, tasks, pending_pass_overs, now, shifts } = data;
  const myShift = shifts.find((s) => s.username === me.username);
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

  async function accept(task: DailyTask) {
    if (togglingId !== null) return;
    setTogglingId(task.id);
    setError("");
    try {
      const updated = await acceptPassOver(task.id);
      onChanged(updated);
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      else setError(describeError(err));
    } finally {
      setTogglingId(null);
    }
  }

  const shiftLabel = me.role
    ? `${ROLE_LABEL[me.role]} · ${me.shift_start}–${me.shift_end}`
    : "No fixed role today";
  const nextTitle =
    me.role === "opening" ? "the closing team" : me.role === "pre_closer" ? "Closer" : "the next shift";

  return (
    <section
      aria-label="My tasks"
      className="mb-[18px] rounded-[16px] border border-white/10 bg-white/[.032] p-[18px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-bold">
          My tasks{me.role ? ` · ${shiftLabel}` : ""} · now {formatClock(now)}
        </h2>
        <span className="text-[12.5px] font-semibold text-white/55 tabular-nums">
          {done} of {total} done
        </span>
      </div>
      <p className="mt-1 text-[12.5px] text-white/55">
        Fixed, time-based tasks for this shift — not your whole workload.
        Guest replies, Tracking, Orders and the rest aren&rsquo;t tracked
        here.
      </p>
      <p className="mt-1 text-[12.5px] text-white/55">
        Finish these before your shift ends. Anything left must be passed to{" "}
        {nextTitle} and accepted.
      </p>

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

      {pending_pass_overs.length > 0 ? (
        <ul className="mt-3.5 flex flex-col gap-2.5">
          {pending_pass_overs.map((task) => (
            <li
              key={task.id}
              className="rounded-lg border border-[#fbbf24]/45 bg-[#fbbf24]/[.08] p-3.5"
            >
              <p className="text-[11px] font-bold tracking-[.04em] text-[#fbbf24] uppercase">
                Passed over to you — accept to add to your list
              </p>
              <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold">{task.title}</p>
                  <p className="mt-0.5 text-[12px] text-white/55">
                    From {task.pass_over?.from_display_name} ·{" "}
                    {ROLE_LABEL[task.pass_over?.from_role ?? "team"]}
                  </p>
                  {task.pass_over?.note ? (
                    <p className="mt-0.5 text-[12px] text-white/45">
                      Note: {task.pass_over.note}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void accept(task)}
                  disabled={togglingId !== null}
                  className="shrink-0 rounded-lg border border-[#fbbf24] bg-[#fbbf24] px-4 py-1.5 text-[13px] font-bold text-[#1a1203] hover:bg-[#f5b50f] disabled:opacity-60"
                >
                  {togglingId === task.id ? "Accepting…" : "Accept"}
                </button>
              </div>
            </li>
          ))}
        </ul>
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
        "flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border px-3.5 py-2.5",
        task.done
          ? "border-white/5 bg-white/[.015]"
          : status === "overdue"
            ? "border-[#f87171]/30 bg-[#f87171]/[.05]"
            : "border-white/10 bg-white/[.025]",
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
