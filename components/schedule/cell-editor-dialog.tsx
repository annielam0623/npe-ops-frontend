"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { formatClock, hasBadTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type {
  ScheduleCell,
  ScheduleCellInput,
  ScheduleEmployee,
  ScheduleShiftType,
} from "@/types";

import { INPUT } from "./config";

interface CellEditorDialogProps {
  employee: ScheduleEmployee;
  /** "YYYY-MM-DD"。 */
  date: string;
  dateLabel: string;
  /** 这一格还没排过时为 null。 */
  cell: ScheduleCell | null;
  shiftTypes: ScheduleShiftType[];
  onSave: (input: ScheduleCellInput) => Promise<ActionResult>;
  onClose: () => void;
}

// 不走共用 Modal（它的面板底色固定是 bg-paper，给「主样子浅色、全深色靠 night: 切换」的页面用）。
// 这页和 Dispatch 一样是旧后台没有对应实现的新功能，本来就一直是深色（CLAUDE.md），照 forecast/cell-editor.tsx
// 的写法自己画居中深色弹框：背景 + Esc / 点背景关闭、保存中不能关。
export function CellEditorDialog({
  employee,
  date,
  dateLabel,
  cell,
  shiftTypes,
  onSave,
  onClose,
}: CellEditorDialogProps) {
  const titleId = useId();
  const shiftId = useId();
  const startId = useId();
  const endId = useId();
  const noteId = useId();
  const pressedOnBackdropRef = useRef(false);

  const [shiftType, setShiftType] = useState(cell?.shift_type ?? "");
  const [startTime, setStartTime] = useState(cell?.start_time ?? "");
  const [endTime, setEndTime] = useState(cell?.end_time ?? "");
  const [note, setNote] = useState(cell?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const badRange = hasBadTimeRange(startTime || null, endTime || null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    const result = await onSave({
      employee_id: employee.id,
      date,
      shift_type: shiftType || null,
      start_time: startTime || null,
      end_time: endTime || null,
      note: note.trim(),
    });
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
    }
  }

  async function handleClear() {
    if (saving) return;
    setError(null);
    setSaving(true);
    const result = await onSave({
      employee_id: employee.id,
      date,
      shift_type: null,
      start_time: null,
      end_time: null,
      note: "",
    });
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
    }
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
          event.target === event.currentTarget &&
          !saving
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
        className="w-full max-w-[420px] rounded-xl border border-white/10 bg-[#0d1b2e] p-6 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <form noValidate onSubmit={handleSubmit}>
          <h2
            id={titleId}
            className="mb-1 text-[16px] font-semibold text-white"
          >
            {employee.name}
          </h2>
          <p className="mb-4 text-[13px] text-white/55">{dateLabel}</p>

          <label
            htmlFor={shiftId}
            className="mb-1 block text-[12px] font-medium text-white/75"
          >
            Shift
          </label>
          <select
            id={shiftId}
            value={shiftType}
            onChange={(event) => setShiftType(event.target.value)}
            className={cn(INPUT, "mb-3.5 w-full")}
          >
            <option value="">— Not set —</option>
            {shiftTypes
              .filter((t) => t.is_active || t.key === shiftType)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
          </select>

          <div className="mb-1 flex gap-3.5">
            <div className="flex-1">
              <label
                htmlFor={startId}
                className="mb-1 block text-[12px] font-medium text-white/75"
              >
                Start
              </label>
              <input
                id={startId}
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className={cn(INPUT, "w-full")}
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor={endId}
                className="mb-1 block text-[12px] font-medium text-white/75"
              >
                End
              </label>
              <input
                id={endId}
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className={cn(INPUT, "w-full")}
              />
            </div>
          </div>
          {badRange ? (
            <p className="mb-3.5 rounded-[8px] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] leading-[1.6] text-amber-200">
              ⚠️ End time ({formatClock(endTime || null)}) is not after start
              time. This cell will be highlighted yellow on the grid and
              won&apos;t count as coverage for the work window.
            </p>
          ) : null}

          <label
            htmlFor={noteId}
            className="mb-1 block text-[12px] font-medium text-white/75"
          >
            Note
          </label>
          <textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional"
            className={cn(INPUT, "mb-4 w-full resize-none")}
          />

          {error ? (
            <p role="alert" className="mb-3.5 text-[12px] text-red-300">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleClear}
              disabled={saving || (!cell?.shift_type && !cell?.start_time)}
              className={cn(DARK_SECONDARY_BUTTON_CLASS, "text-white/60")}
            >
              Clear
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={DARK_PRIMARY_BUTTON_CLASS}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
