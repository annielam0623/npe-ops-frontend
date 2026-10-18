"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { shiftYmd } from "@/lib/la-date";
import type { RecentShift } from "@/lib/schedule-recent";
import { formatClock, hasBadTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type { ScheduleShiftType } from "@/types";

import { DAY_LABELS, INPUT, shiftCardClass } from "./config";

export interface AddShiftInput {
  dates: string[];
  shiftType: ScheduleShiftType;
  start: string;
  end: string;
}

interface AddShiftDialogProps {
  weekStart: string;
  /** 点的是哪一天的格子（默认勾上这一天）。 */
  date: string;
  /** null = 加到「Unassigned」（还没人的班）。 */
  employeeName: string | null;
  shiftTypes: ScheduleShiftType[];
  /** 这个人最近排过的班，点一下就填上班次和时间。 */
  recents: RecentShift[];
  defaultStart: string;
  defaultEnd: string;
  onSubmit: (input: AddShiftInput) => void;
  onClose: () => void;
}

/**
 * 加班窗口（Annie 2026-10-18：一天天加太麻烦、Anita 的 8:00–5:00 找不到）：
 * 选班次、填上下班时间、可以一次勾好几天，按一下加完；常用的班次 + 时间出现在上面一排，点一下就填。
 * 不走共用 Modal（理由同 add-employee-dialog.tsx：这页永久深色）。
 */
export function AddShiftDialog({
  weekStart,
  date,
  employeeName,
  shiftTypes,
  recents,
  defaultStart,
  defaultEnd,
  onSubmit,
  onClose,
}: AddShiftDialogProps) {
  const titleId = useId();
  const startId = useId();
  const endId = useId();
  const pressedOnBackdropRef = useRef(false);
  const [typeKey, setTypeKey] = useState(shiftTypes[0]?.key ?? "");
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [days, setDays] = useState<Set<string>>(() => new Set([date]));

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const shiftType = shiftTypes.find((t) => t.key === typeKey);
  const bad = hasBadTimeRange(start, end);
  const canAdd = !!shiftType && !!start && !!end && days.size > 0;

  function toggleDay(d: string) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAdd || !shiftType) return;
    onSubmit({
      dates: dates.filter((d) => days.has(d)),
      shiftType,
      start,
      end,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedOnBackdropRef.current &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-[460px] rounded-xl border border-white/10 bg-[#0d1b2e] p-5 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
          <h2 id={titleId} className="text-[16px] font-semibold text-white">
            Add shift{employeeName ? ` — ${employeeName}` : " — Unassigned"}
          </h2>

          {recents.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-white/75">
                Recent
              </span>
              <div className="flex flex-wrap gap-1.5">
                {recents.map((r) => (
                  <button
                    key={`${r.type}|${r.start}|${r.end}`}
                    type="button"
                    data-recent-shift
                    onClick={() => {
                      if (shiftTypes.some((t) => t.key === r.type))
                        setTypeKey(r.type);
                      setStart(r.start);
                      setEnd(r.end);
                    }}
                    className={cn(
                      "cursor-pointer rounded-[6px] border px-2 py-1 text-[11.5px] font-semibold",
                      shiftCardClass(r.type),
                    )}
                  >
                    {shiftTypes.find((t) => t.key === r.type)?.label ?? r.type}{" "}
                    · {formatClock(r.start)} – {formatClock(r.end)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-white/75">Shift</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {shiftTypes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={typeKey === t.key}
                  onClick={() => setTypeKey(t.key)}
                  className={cn(
                    "cursor-pointer rounded-[6px] border px-3 py-1 text-[12.5px] font-bold",
                    typeKey === t.key
                      ? cn(shiftCardClass(t.key), "ring-2 ring-sky-400/70")
                      : "border-white/20 text-white/80 hover:border-white/40",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2.5">
            <label
              htmlFor={startId}
              className="flex flex-col gap-1 text-[12px] font-medium text-white/75"
            >
              Start
              <input
                id={startId}
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={cn(INPUT, "w-[120px]")}
              />
            </label>
            <label
              htmlFor={endId}
              className="flex flex-col gap-1 text-[12px] font-medium text-white/75"
            >
              End
              <input
                id={endId}
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={cn(INPUT, "w-[120px]")}
              />
            </label>
            {bad ? (
              <span className="pb-2 text-[11.5px] text-amber-200">
                End isn&apos;t after start
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-white/75">Days</span>
            <div className="flex flex-wrap gap-1.5">
              {dates.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  data-day={d}
                  aria-pressed={days.has(d)}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "cursor-pointer rounded-[6px] border px-2.5 py-1 text-[12px] font-bold",
                    days.has(d)
                      ? "border-sky-400/60 bg-sky-400/20 text-sky-200"
                      : "border-white/20 text-white/70 hover:border-white/40",
                  )}
                >
                  {DAY_LABELS[i]} {d.slice(5).replace("-", "/")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canAdd}
              className={DARK_PRIMARY_BUTTON_CLASS}
            >
              {days.size > 1 ? `Add ${days.size} shifts` : "Add shift"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
