"use client";

import { useId, useState } from "react";

import { describeError } from "@/lib/api-errors";
import { passOverTask } from "@/lib/tasks-api";
import type { DailyTask } from "@/types";

import {
  defaultFinishBy,
  formatHHMM,
  laWallClockToIso,
  type PassOverReceiver,
} from "./config";

/**
 * 没做完的任务交给下一班（任务包第 21 条）：写说明、发给下一班的人；任务仍在我名下，
 * 显示「等待接受」，对方 Accept 后才转移（没有拒绝）。
 * G202：交出时设 Finish by（Annie 第 6 条），默认接收人上班后 1 小时、只能选接收人班次里的时间；
 * 接受后按这个时间排进接收人的时间线。后端没上线（`receiver.finishByLive` 为 false）时不出这一格、不发这个字段。
 */
export function PassOverDialog({
  task,
  receiver,
  onDismiss,
  onPassedOver,
}: {
  task: DailyTask;
  receiver: PassOverReceiver;
  onDismiss: () => void;
  onPassedOver: (task: DailyTask) => void;
}) {
  const titleId = useId();
  const finishById = useId();
  const [note, setNote] = useState("");
  const [finishBy, setFinishBy] = useState(() => defaultFinishBy(receiver));
  const { name, shiftStart, shiftEnd, finishByLive } = receiver;
  const shiftText =
    shiftStart && shiftEnd
      ? `${formatHHMM(shiftStart)}–${formatHHMM(shiftEnd)}`
      : null;
  // 跨午夜的班（下班时间比上班早）不限范围，免得 min > max 选不了。
  const bounded = !!(shiftStart && shiftEnd && shiftEnd > shiftStart);
  const outOfShift =
    bounded &&
    !!finishBy &&
    (finishBy < (shiftStart as string) || finishBy > (shiftEnd as string));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (finishByLive && !finishBy) {
      setError("Pick a finish-by time.");
      return;
    }
    if (finishByLive && outOfShift) {
      setError(`Pick a time within ${name ?? "their"}’s shift (${shiftText}).`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await passOverTask(
        task.id,
        note.trim(),
        finishByLive
          ? laWallClockToIso(receiver.workDate, finishBy)
          : undefined,
      );
      onPassedOver(updated);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onDismiss();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#0e1b2e] p-5 text-white shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
      >
        <h2 id={titleId} className="text-[15px] font-bold">
          Pass over “{task.title}”
        </h2>
        <p className="mt-1 text-[12.5px] text-white/55">
          {name
            ? `Goes to ${name} (next shift${shiftText ? `, ${shiftText}` : ""}). They can only accept — there’s no decline.`
            : "Goes to whoever is on the next shift. They can only accept — there’s no decline."}
        </p>
        {finishByLive ? (
          <>
            <label
              htmlFor={finishById}
              className="mt-3.5 block text-[12px] font-semibold text-white/70"
            >
              Finish by
            </label>
            <input
              id={finishById}
              type="time"
              required
              value={finishBy}
              min={bounded ? (shiftStart as string) : undefined}
              max={bounded ? (shiftEnd as string) : undefined}
              onChange={(event) => setFinishBy(event.target.value)}
              disabled={busy}
              className="mt-1 block w-[150px] rounded-lg border border-white/15 bg-white/[.04] px-3 py-2 text-[13px] text-white [color-scheme:dark] outline-none focus:border-[#185FA5] disabled:opacity-60"
            />
            <p data-finish-by-hint className="mt-1 text-[11.5px] text-white/55">
              {finishBy
                ? `Shows in ${name ?? "their"}’s list at ${formatHHMM(finishBy)}.`
                : "Shows in their list at this time."}
              {shiftText
                ? ` Pick a time within ${name ?? "their"}’s shift (${shiftText}).`
                : ""}
            </p>
          </>
        ) : null}
        <label className="mt-3.5 block text-[12px] font-semibold text-white/70">
          Note for the next shift (optional)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
            rows={3}
            placeholder="What’s left to do, anything they need to know…"
            className="mt-1 w-full resize-none rounded-lg border border-white/15 bg-white/[.04] px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-[#185FA5] disabled:opacity-60"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2.5 text-[12.5px] text-[#f87171]">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-lg border border-white/15 px-3.5 py-1.5 text-[13px] font-semibold text-white/70 hover:text-white disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg border border-[#185FA5] bg-[#185FA5] px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1468a0] disabled:opacity-60"
          >
            {busy ? "Passing over…" : "Pass over"}
          </button>
        </div>
      </div>
    </div>
  );
}
