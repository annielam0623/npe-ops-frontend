"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { updateTodayTask, type UpdateTodayTaskInput } from "@/lib/tasks-api";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { DailyTask, StaffShiftToday, TaskPriority } from "@/types";

import { shiftOptionLabel } from "./add-task-row";

/**
 * 今天任务的 Edit（前端 139 = 后端 G269，preview ① https://claude.ai/artifact/3aVYWfWYk4RgntEaBjovTh）。
 * Annie 2026-11-14「B, A, A, A 动手」+「照推荐」：
 * - Supervisor / Admin：今天的任何任务，标题、优先级、给谁（For）三项都能改；
 * - 员工：只能改自己名下的（不含 Everyone on shift），只改标题和优先级；换人走 Pass over。
 * 在这一行里展开表单，改了先暂存，按蓝色 Save 才存；只改今天这一条，明天照 Daily task list 重新生成。
 * 有没接受的交接时换人后端回 409，红字原话，表单留着。
 */

const PRIORITY_TEXT: Record<TaskPriority, string> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

const EVERYONE = "";
/** 现在的负责人不在今天的班表里（或班表没带 admin_user_id）：留着原样，不当成改动。 */
const CURRENT = "current";

/**
 * 外层（任务框）用：哪几条 Edit 表单有没存的改动；有就挂离开页面的提醒（跳页、关标签都先问）。
 * 返回给 TaskEditForm 的 onDirtyChange 用的工厂（同一条任务拿到的是同一个函数）。
 */
export function useEditLeaveGuard(): (id: number) => (dirty: boolean) => void {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [reporters] = useState(
    () => new Map<number, (dirty: boolean) => void>(),
  );
  useLeaveGuard(
    dirtyIds.size > 0,
    "You have unsaved changes to a task. Leave without saving?",
  );
  return useCallback(
    (id: number) => {
      let fn = reporters.get(id);
      if (!fn) {
        fn = (dirty: boolean) =>
          setDirtyIds((prev) => {
            if (prev.has(id) === dirty) return prev;
            const next = new Set(prev);
            if (dirty) next.add(id);
            else next.delete(id);
            return next;
          });
        reporters.set(id, fn);
      }
      return fn;
    },
    [reporters],
  );
}

/**
 * 从前几天带过来的（carry-over，work_date 不是今天）：PATCH 只认今天的任务，会回 404，这类行不显示 Edit
 * （前端主窗口 2026-11-16；要不要也能改等 Annie 定，要的话后端得改）。
 */
export function isCarryOver(task: DailyTask, date: string): boolean {
  return !!task.work_date && task.work_date !== date;
}

/** 员工能不能改这一条：自己名下的才行（Everyone on shift 的不行）。 */
export function canStaffEdit(task: DailyTask, me: string): boolean {
  return task.assigned_to_username !== null && task.assigned_to_username === me;
}

export function EditTaskButton({
  task,
  onClick,
  disabled,
  className,
}: {
  task: DailyTask;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-task-edit
      aria-label={`Edit ${task.title}`}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "shrink-0 rounded-lg border border-white/20 bg-transparent font-semibold text-white hover:border-white/40 disabled:opacity-40",
        className ?? "px-2 py-px text-[11.5px]",
      )}
    >
      Edit
    </button>
  );
}

export function TaskEditForm({
  task,
  shifts,
  canAssign,
  onSaved,
  onClose,
  onUnauthorized,
  onDirtyChange,
  className,
}: {
  task: DailyTask;
  shifts: StaffShiftToday[];
  /** 有没有没存的改动（外层用来挂离开页面的提醒）；要传稳定的函数。 */
  onDirtyChange?: (dirty: boolean) => void;
  /** Supervisor / Admin 才有「For」（给谁）。 */
  canAssign: boolean;
  onSaved: (task: DailyTask) => void;
  onClose: () => void;
  onUnauthorized: () => void;
  className?: string;
}) {
  const people = shifts.filter((s) => s.admin_user_id != null);
  const assigneeValue = (t: DailyTask): string => {
    if (t.assigned_to_username === null) return EVERYONE;
    const s = people.find((p) => p.username === t.assigned_to_username);
    return s ? `u:${s.admin_user_id}` : CURRENT;
  };

  const [base, setBase] = useState(() => ({
    title: task.title,
    priority: task.priority,
    assignee: assigneeValue(task),
  }));
  const [draft, setDraft] = useState(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty =
    draft.title !== base.title ||
    draft.priority !== base.priority ||
    draft.assignee !== base.assignee;

  // 打开时把这一行滚进时间线框里（框一次只露 3 条）。
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const li = rootRef.current?.closest("li");
    const box = li?.closest<HTMLElement>("[data-timeline-scroll]");
    if (li && box) {
      requestAnimationFrame(() => {
        if (li.offsetTop < box.scrollTop || li.offsetTop + li.offsetHeight > box.scrollTop + box.clientHeight)
          box.scrollTop = li.offsetTop;
      });
    }
  }, []);

  // 离开页面的提醒由外层统一挂（useLeaveGuard 同一时刻只能有一个），这里只报有没有没存的改动。
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function cancel() {
    if (busy) return;
    if (dirty && !window.confirm("You have unsaved changes. Discard them?"))
      return;
    onClose();
  }

  async function save() {
    if (busy) return;
    const title = draft.title.trim();
    if (!title) {
      setError("Write the task first.");
      setSaved(false);
      return;
    }
    const changes: UpdateTodayTaskInput = {};
    if (title !== base.title) changes.title = title;
    if (draft.priority !== base.priority) changes.priority = draft.priority;
    if (canAssign && draft.assignee !== base.assignee && draft.assignee !== CURRENT)
      changes.assigned_admin_user_id =
        draft.assignee === EVERYONE ? null : Number(draft.assignee.slice(2));
    if (Object.keys(changes).length === 0) {
      setDraft({ ...draft, title });
      setError("");
      setSaved(true);
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const updated = await updateTodayTask(task.id, changes);
      const next = {
        title: updated.title,
        priority: updated.priority,
        assignee: assigneeValue(updated),
      };
      setBase(next);
      setDraft(next);
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      // 400 / 403 / 409：后端原话红字，表单内容留着。
      else setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "flex min-w-0 flex-col gap-1 text-[12px] font-semibold text-white/70";
  const input =
    "w-full min-w-0 rounded-[7px] border border-white/15 bg-white/[.04] px-[9px] py-1.5 text-[13px] font-normal text-white [color-scheme:dark] outline-none focus:border-[#185FA5] disabled:opacity-60";

  return (
    <div
      ref={rootRef}
      data-task-edit-form={task.id}
      className={cn("flex flex-col gap-2.5", className)}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
        <label className={cn(label, "col-span-full")}>
          Task
          <input
            data-field="title"
            value={draft.title}
            onChange={(e) => {
              setDraft({ ...draft, title: e.target.value });
              setSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            disabled={busy}
            className={input}
          />
        </label>
        <label className={label}>
          Priority
          <select
            data-field="priority"
            value={draft.priority}
            onChange={(e) => {
              setDraft({ ...draft, priority: e.target.value as TaskPriority });
              setSaved(false);
            }}
            disabled={busy}
            className={input}
          >
            {(["high", "moderate", "low"] as const).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_TEXT[p]}
              </option>
            ))}
          </select>
        </label>
        {canAssign ? (
          <label className={label}>
            For
            <select
              data-field="for"
              value={draft.assignee}
              onChange={(e) => {
                setDraft({ ...draft, assignee: e.target.value });
                setSaved(false);
              }}
              disabled={busy}
              className={input}
            >
              <option value={EVERYONE}>Everyone on shift today</option>
              {base.assignee === CURRENT ? (
                <option value={CURRENT}>
                  {task.assigned_to_display_name ?? task.assigned_to_username}
                </option>
              ) : null}
              {people.map((s) => (
                <option key={s.username} value={`u:${s.admin_user_id}`}>
                  {shiftOptionLabel(s, people)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-[5px] text-[12.5px] font-bold text-white hover:bg-[#2f76e8] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-lg border border-white/[.18] bg-transparent px-3 py-[5px] text-[12.5px] text-white/75 hover:text-white disabled:opacity-60"
        >
          {saved && !dirty ? "Close" : "Cancel"}
        </button>
        {saved && !dirty ? (
          <span role="status" className="text-[12px] font-bold text-[#4ade80]">
            Saved
          </span>
        ) : (
          <span className="text-[11.5px] text-white/55">
            Changes this task for today only.
            {canAssign && task.template_id !== null
              ? " Tomorrow’s comes from the Daily task list."
              : ""}
          </span>
        )}
      </div>
    </div>
  );
}
