"use client";

import { useState } from "react";

import { describeError } from "@/lib/api-errors";
import { addTask } from "@/lib/tasks-api";
import { cn } from "@/lib/utils";
import type { DailyTask, StaffShiftToday, TaskRole } from "@/types";

import { laWallClockToIso, ROLE_LABEL } from "./config";

type Target =
  | { kind: "role"; role: TaskRole }
  | { kind: "person"; username: string; displayName: string };

/** 主管加任务（任务包第 18 条）：选岗位或具体某人，可填截止时间。 */
export function AddTaskRow({
  date,
  shifts,
  onAdded,
}: {
  date: string;
  shifts: StaffShiftToday[];
  onAdded: (task: DailyTask) => void;
}) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState<Target>({ kind: "role", role: "opening" });
  const [dueTime, setDueTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const named = shifts.filter((s) => s.role === null);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const task = await addTask({
        title: trimmed,
        role: target.kind === "role" ? target.role : "team",
        assigned_to_username: target.kind === "person" ? target.username : null,
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
        {(["opening", "pre_closer", "closer", "team"] as TaskRole[]).map((role) => (
          <Chip
            key={role}
            active={target.kind === "role" && target.role === role}
            onClick={() => setTarget({ kind: "role", role })}
          >
            {ROLE_LABEL[role]}
          </Chip>
        ))}
        {named.map((s) => (
          <Chip
            key={s.username}
            active={target.kind === "person" && target.username === s.username}
            onClick={() =>
              setTarget({ kind: "person", username: s.username, displayName: s.display_name })
            }
          >
            {s.display_name}
          </Chip>
        ))}
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] font-semibold whitespace-nowrap",
        active
          ? "border-[#185FA5] bg-[#185FA5]/20 text-white"
          : "border-white/15 text-white/60 hover:border-white/30 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
