"use client";

import { useId, useState } from "react";

import {
  BTN_GREEN,
  BTN_PLAIN,
  BTN_RED,
  ErrorBox,
  HINT,
  INP,
  LABEL,
  LeaveDialogShell,
} from "@/components/hr/schedule-leave/ui";
import { dayLabel } from "@/lib/schedule-leave";
import { cn } from "@/lib/utils";
import type { ScheduleShiftType } from "@/types";

import type { DraftSlot } from "./draft";

/*
 * 点空格子 = 加一个班（或改去录假）；点已有的班 = 改班次 / 时间 / 备注、删掉。
 * 都只改页面草稿（灰绿键），页底 Save 才存（先选后存，CLAUDE.md）。
 */

const NOTE_MAX = 120;

export function ShiftDialog({
  slot,
  date,
  personName,
  shiftTypes,
  onApply,
  onDelete,
  onAddLeave,
  onClose,
}: {
  /** 有 = 改这个班；没有 = 在 date 加一个。 */
  slot?: DraftSlot | null;
  date: string;
  personName: string | null;
  shiftTypes: ScheduleShiftType[];
  onApply: (v: Pick<DraftSlot, "shift_type" | "start_time" | "end_time" | "note">) => void;
  onDelete?: () => void;
  /** 有 = 显示「Add leave instead」（人格子，不是 Unassigned）。 */
  onAddLeave?: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const active = shiftTypes.filter((t) => t.is_active || t.key === slot?.shift_type);
  const first = active[0];
  const [type, setType] = useState(slot?.shift_type ?? first?.key ?? "");
  const t0 = active.find((t) => t.key === type);
  const [start, setStart] = useState(slot?.start_time ?? t0?.default_start_time?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(slot?.end_time ?? t0?.default_end_time?.slice(0, 5) ?? "17:00");
  const [note, setNote] = useState(slot?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const pickType = (k: string) => {
    setType(k);
    if (!slot) {
      const t = active.find((x) => x.key === k);
      if (t?.default_start_time) setStart(t.default_start_time.slice(0, 5));
      if (t?.default_end_time) setEnd(t.default_end_time.slice(0, 5));
    }
  };

  const apply = () => {
    if (!type) return setError("Pick a shift type.");
    if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end)) return setError("Enter a start and end time.");
    if (end <= start) return setError("The end time must be after the start time.");
    const clean = note.replace(/[\r\n\t]+/g, " ").trim();
    onApply({ shift_type: type, start_time: start, end_time: end, note: clean || null });
  };

  return (
    <LeaveDialogShell
      titleId={titleId}
      title={`${slot ? "Shift" : "Add shift"} · ${personName ?? "Unassigned"} · ${dayLabel(date)}`}
      onClose={onClose}
      footer={
        <>
          {slot && onDelete ? (
            <button type="button" className={cn(BTN_RED, "mr-auto")} onClick={onDelete} data-ov-delete-shift>
              Delete shift
            </button>
          ) : null}
          <button type="button" className={BTN_PLAIN} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_GREEN} onClick={apply} data-ov-apply-shift>
            {slot ? "Change" : "Add"}
          </button>
        </>
      }
    >
      {!slot && onAddLeave ? (
        <div className={HINT}>
          Adding leave instead?{" "}
          <button type="button" className="cursor-pointer font-semibold underline" onClick={onAddLeave} data-ov-to-leave>
            Add leave
          </button>
        </div>
      ) : null}
      <div className="grid gap-[3px]">
        <label className={LABEL} htmlFor={`${titleId}-t`}>
          Shift
        </label>
        <select id={`${titleId}-t`} className={INP} value={type} onChange={(e) => pickType(e.target.value)}>
          {active.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="time" step={1800} aria-label="Start" className={INP} value={start} onChange={(e) => setStart(e.target.value)} />
        –
        <input type="time" step={1800} aria-label="End" className={INP} value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="grid gap-[3px]">
        <label className={LABEL} htmlFor={`${titleId}-n`}>
          Note (optional)
        </label>
        <input
          id={`${titleId}-n`}
          className={INP}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className={HINT}>Nothing is saved until you press Save at the bottom of the page.</div>
      <ErrorBox text={error} />
    </LeaveDialogShell>
  );
}
