"use client";

import { useState } from "react";

import { describeError } from "@/lib/api-errors";
import { addTask } from "@/lib/tasks-api";
import type { DailyTask, StaffShiftToday } from "@/types";

import { formatHHMM, laWallClockToIso } from "./config";

/** 下拉里「没指定人」那一项的值（真实用户名不会是空串）。 */
const EVERYONE = "";

/**
 * 下拉选项文字：显示名 + 今天的班次（同下面任务分组标题）；两个人显示名一样时补用户名区分。
 */
export function shiftOptionLabel(
  shift: StaffShiftToday,
  all: StaffShiftToday[],
): string {
  const same = all.filter((s) => s.display_name === shift.display_name).length;
  const name =
    same > 1 ? `${shift.display_name} (${shift.username})` : shift.display_name;
  return `${name} · ${formatHHMM(shift.shift_start)}–${formatHHMM(shift.shift_end)}`;
}

/**
 * 主管加任务（任务包第 18 条）：默认加给今天在班的所有人，也可以指定今天在班的某一个人（后端 G160 的
 * assigned_to_username，按 shifts[].username 原样传；Annie 2026-10-23「主管加任务：动手」）。可填截止时间。
 */
export function AddTaskRow({
  date,
  shifts,
  onAdded,
}: {
  date: string;
  /** 今天的班表，下拉的选项从这里来。 */
  shifts: StaffShiftToday[];
  onAdded: (task: DailyTask) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [assignee, setAssignee] = useState(EVERYONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const task = await addTask({
        title: trimmed,
        assigned_admin_user_id: null,
        // 没指定人就不传这个字段（行为同以前：加给今天在班的所有人）。
        ...(assignee !== EVERYONE ? { assigned_to_username: assignee } : {}),
        due_at: dueTime ? laWallClockToIso(date, dueTime) : null,
      });
      onAdded(task);
      setTitle("");
      setDueTime("");
      setAssignee(EVERYONE);
    } catch (err) {
      // 400（例如 No active staff account with username '…'）：后端原话，输入和选择都留着。
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-white/10 bg-white/[.02] p-3.5">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder="What needs to be done"
        disabled={busy}
        className="w-full rounded-lg border border-white/15 bg-white/[.04] px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-[#185FA5] disabled:opacity-60"
      />
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-white/50">
          For
          <select
            aria-label="For"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            disabled={busy || shifts.length === 0}
            className="max-w-full min-w-0 rounded-md border border-white/15 bg-white/[.04] px-2 py-1 text-[12.5px] text-white outline-none [color-scheme:dark] focus:border-[#185FA5] disabled:opacity-50"
          >
            <option value={EVERYONE}>Everyone on shift today</option>
            {shifts.map((shift) => (
              <option key={shift.username} value={shift.username}>
                {shiftOptionLabel(shift, shifts)}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-white/50">
          Finish by
          <input
            type="time"
            aria-label="Finish by"
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
            disabled={busy}
            className="rounded-md border border-white/15 bg-white/[.04] px-2 py-1 text-[12.5px] text-white outline-none [color-scheme:dark] focus:border-[#185FA5] disabled:opacity-60"
          />
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !title.trim()}
          className="rounded-lg border border-[#185FA5] bg-[#185FA5] px-3.5 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#1468a0] disabled:cursor-default disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
