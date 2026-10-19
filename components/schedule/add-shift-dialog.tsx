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
import type { ScheduleShiftType, ScheduleTimeOffKind } from "@/types";

import {
  DAY_LABELS,
  INPUT,
  shiftCardClass,
  TIME_OFF_LABEL,
} from "./config";

export interface AddShiftInput {
  dates: string[];
  shiftType: ScheduleShiftType;
  start: string;
  end: string;
  /** 可选备注（≤120 字）；没填 = 不带。 */
  note: string | null;
}

export interface AddTimeOffInput {
  dates: string[];
  kind: ScheduleTimeOffKind;
  note: string | null;
}

const NOTE_MAX = 120;
const TIME_OFF_KINDS: ScheduleTimeOffKind[] = ["pto", "sick", "personal"];

/** 备注不能含换行 / 控制字符（后端会拒）：输入时直接去掉。 */
export function cleanNote(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** 选了班次就用它的默认上下班时间，没设（或后端还没带）就用工作时段起止。 */
function timesFor(
  type: ScheduleShiftType | undefined,
  fallbackStart: string,
  fallbackEnd: string,
): { start: string; end: string } {
  if (type?.default_start_time && type.default_end_time) {
    return { start: type.default_start_time, end: type.default_end_time };
  }
  return { start: fallbackStart, end: fallbackEnd };
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
  /**
   * 录休假（只有排到具体某个人的格子才有）；返回 null = 成功（窗口关），返回文字 = 后端原话，窗口不关，红框显示。
   * 没传 = 不显示 Shift | Time off 切换。
   */
  onSubmitTimeOff?: (input: AddTimeOffInput) => Promise<string | null>;
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
  onSubmitTimeOff,
  onClose,
}: AddShiftDialogProps) {
  const titleId = useId();
  const startId = useId();
  const endId = useId();
  const noteId = useId();
  const pressedOnBackdropRef = useRef(false);
  const [typeKey, setTypeKey] = useState(shiftTypes[0]?.key ?? "");
  const [start, setStart] = useState(
    () => timesFor(shiftTypes[0], defaultStart, defaultEnd).start,
  );
  const [end, setEnd] = useState(
    () => timesFor(shiftTypes[0], defaultStart, defaultEnd).end,
  );
  const [days, setDays] = useState<Set<string>>(() => new Set([date]));
  const [mode, setMode] = useState<"shift" | "off">("shift");
  const [kind, setKind] = useState<ScheduleTimeOffKind>("pto");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickType(t: ScheduleShiftType) {
    setTypeKey(t.key);
    // 只有这个班次设了默认时间才改时间；没设就保持现在填的（可能是刚点的 Recent 或手填的）。
    if (t.default_start_time && t.default_end_time) {
      setStart(t.default_start_time);
      setEnd(t.default_end_time);
    }
  }

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
  const isOff = mode === "off";
  const canAdd = isOff
    ? days.size > 0 && !busy
    : !!shiftType && !!start && !!end && days.size > 0;

  function toggleDay(d: string) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAdd) return;
    const chosen = dates.filter((d) => days.has(d));
    const cleaned = note.trim();
    if (isOff) {
      if (!onSubmitTimeOff) return;
      setBusy(true);
      setError(null);
      const message = await onSubmitTimeOff({
        dates: chosen,
        kind,
        note: cleaned || null,
      });
      setBusy(false);
      if (message) setError(message);
      return;
    }
    if (!shiftType) return;
    onSubmit({
      dates: chosen,
      shiftType,
      start,
      end,
      note: cleaned || null,
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
            {isOff ? "Add time off" : "Add shift"}
            {employeeName ? ` — ${employeeName}` : " — Unassigned"}
          </h2>

          {onSubmitTimeOff ? (
            <div className="flex gap-1.5" role="tablist">
              {(["shift", "off"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  data-mode={m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={cn(
                    "cursor-pointer rounded-[6px] border px-3 py-1 text-[12.5px] font-bold",
                    mode === m
                      ? "border-sky-400/60 bg-sky-400/[.18] text-sky-200"
                      : "border-white/20 text-white/80 hover:border-white/40",
                  )}
                >
                  {m === "shift" ? "Shift" : "Time off"}
                </button>
              ))}
            </div>
          ) : null}

          {!isOff && recents.length > 0 ? (
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

          {isOff ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-white/75">Type</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup">
                {TIME_OFF_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    data-kind={k}
                    onClick={() => setKind(k)}
                    className={cn(
                      "cursor-pointer rounded-[6px] border px-3 py-1 text-[12.5px] font-bold",
                      kind === k
                        ? "border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] text-[#fde68a] ring-2 ring-sky-400/70"
                        : "border-white/20 text-white/80 hover:border-white/40",
                    )}
                  >
                    {TIME_OFF_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-white/75">Shift</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {shiftTypes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={typeKey === t.key}
                  onClick={() => pickType(t)}
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
          )}

          {!isOff ? (
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
          ) : null}

          <label
            htmlFor={noteId}
            className="flex flex-col gap-1 text-[12px] font-medium text-white/75"
          >
            Note (optional)
            <input
              id={noteId}
              type="text"
              data-note-input
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(cleanNote(e.target.value))}
              className={INPUT}
            />
          </label>

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

          {error ? (
            <div
              role="alert"
              data-dialog-error
              className="rounded-lg border border-red-400/50 bg-red-400/10 px-2.5 py-1.5 text-[12.5px] text-red-200"
            >
              {error}
            </div>
          ) : null}

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
              {isOff
                ? days.size > 1
                  ? `Add ${days.size} days off`
                  : "Add day off"
                : days.size > 1
                  ? `Add ${days.size} shifts`
                  : "Add shift"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
