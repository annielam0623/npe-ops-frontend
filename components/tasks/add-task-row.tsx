"use client";

import { useState } from "react";

import { describeError } from "@/lib/api-errors";
import { addTask } from "@/lib/tasks-api";
import type { DailyTask } from "@/types";

import { laWallClockToIso } from "./config";

/**
 * 主管加任务（任务包第 18 条）：加给今天在班的所有人，可填截止时间。
 * 指定某个人要传 admin_users.id，today 响应里只有用户名，等后端加 assigned_to_username 再做（见 PROGRESS「需要后端」）。
 */
export function AddTaskRow({
  date,
  onAdded,
}: {
  date: string;
  onAdded: (task: DailyTask) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueTime, setDueTime] = useState("");
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
        due_at: dueTime ? laWallClockToIso(date, dueTime) : null,
      });
      onAdded(task);
      setTitle("");
      setDueTime("");
    } catch (err) {
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
        <span className="text-[12px] text-white/50">
          For everyone on shift today
        </span>
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
