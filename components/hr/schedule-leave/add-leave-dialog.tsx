"use client";

import { useId, useState } from "react";

import { cleanNote } from "@/components/schedule/add-shift-dialog";
import { dayLabel, hourlyError, isHourly } from "@/lib/schedule-leave";
import { leaveErrorOf, type LeaveCategory } from "@/lib/schedule-leave-api";
import type { ScheduleTimeOff } from "@/types";

import {
  BTN_BLUE,
  BTN_GREEN,
  BTN_PLAIN,
  BTN_RED,
  ErrorBox,
  HalfHourSelect,
  HINT,
  INP,
  LABEL,
  LeaveDialogShell,
  type LeaveDialogData,
} from "./ui";

/** 录 / 改一条假时交出去的内容（一人一天一条，Q10 A）。 */
export interface LeaveEntry {
  employee_id: number;
  date: string;
  kind: string;
  /** 都 null = 整天。 */
  start_time: string | null;
  end_time: string | null;
  note: string | null;
}

interface AddLeaveDialogProps {
  data: LeaveDialogData;
  employeeId: number;
  date: string;
  /** 有 = 改这条已有的假（设计 2.3「调整请假」，PUT /api/schedule/time-off/{id}）；日期不改。 */
  existing?: ScheduleTimeOff | null;
  /**
   * stage = 先放到页面草稿上，页底 Save 才存（preview v2 灰绿 Add）；
   * direct = 点了就存（蓝键，现在的 PUT /api/schedule/time-off）。等 7d 定合同（range/changes 有没有 time_off op）。
   */
  mode?: "stage" | "direct";
  /** 返回 null = 成功（框关）；返回 / 抛出 = 报错，框不关、红框显示后端原话。 */
  onSubmit: (entry: LeaveEntry) => Promise<string | null> | string | null;
  /** 改已有的假时可以删（直接存，红键）。 */
  onDelete?: (timeOff: ScheduleTimeOff) => Promise<string | null>;
  onClose: () => void;
}

/**
 * 主管直接录假 / 改假（点格子 → Add leave）：所有在用的类别、整天或按小时（半小时一档）。
 * 整天的照旧：那天有班就不能录（同后端 schedule.py:1576-1579 那句，这里先挡）。
 */
export function AddLeaveDialog({
  data,
  employeeId,
  date,
  existing,
  mode = "stage",
  onSubmit,
  onDelete,
  onClose,
}: AddLeaveDialogProps) {
  const titleId = useId();
  const person = data.employees.find((e) => e.id === employeeId);
  const active = data.categories.filter(
    (c) => c.is_active || c.key === existing?.kind,
  );
  const [kind, setKind] = useState(existing?.kind ?? active[0]?.key ?? "pto");
  const [hours, setHours] = useState(existing ? isHourly(existing) : false);
  const [start, setStart] = useState(existing?.start_time ?? "09:00");
  const [end, setEnd] = useState(existing?.end_time ?? "11:00");
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shiftsThatDay = data.slots.filter(
    (s) => s.employee_id === employeeId && s.date === date,
  );
  const timeErr = hours ? hourlyError(start, end) : null;
  const dayBlocked =
    !hours && shiftsThatDay.length > 0
      ? `${person?.name ?? "This person"} has a shift on ${dayLabel(date)}. Move or delete the shift first, or add leave by the hour.`
      : null;
  const takenByOther =
    !existing &&
    data.timeOff.some((t) => t.employee_id === employeeId && t.date === date)
      ? "There is already leave on this day. One leave per person per day."
      : null;
  const problem = timeErr ?? dayBlocked ?? takenByOther;

  async function submit() {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const msg = await onSubmit({
        employee_id: employeeId,
        date,
        kind,
        start_time: hours ? start : null,
        end_time: hours ? end : null,
        note: note.trim() || null,
      });
      if (msg) setError(msg);
    } catch (e) {
      setError(leaveErrorOf(e, "Couldn't save the leave. Try again.").detail);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || !onDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      const msg = await onDelete(existing);
      if (msg) setError(msg);
    } catch (e) {
      setError(leaveErrorOf(e, "Couldn't delete the leave.").detail);
    } finally {
      setBusy(false);
    }
  }

  const name = person?.name ?? "Unknown";
  const submitLabel = existing ? "Update" : "Add";
  return (
    <LeaveDialogShell
      titleId={titleId}
      title={`${existing ? "Edit leave" : "Add leave"} · ${name} · ${dayLabel(date)}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {existing && onDelete ? (
            <button
              type="button"
              className={`${BTN_RED} mr-auto`}
              onClick={remove}
              disabled={busy}
            >
              Delete leave
            </button>
          ) : null}
          <button type="button" className={BTN_PLAIN} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            data-add-leave
            className={mode === "stage" ? BTN_GREEN : BTN_BLUE}
            disabled={!!problem || busy}
            onClick={submit}
          >
            {busy ? "Saving…" : submitLabel}
          </button>
        </>
      }
    >
      <div className="grid gap-[3px]">
        <label className={LABEL} htmlFor={`${titleId}-type`}>
          Type
        </label>
        <select
          id={`${titleId}-type`}
          className={INP}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {active.map((c: LeaveCategory) => (
            <option key={c.key} value={c.key}>
              {c.label}
              {c.is_active ? "" : " (not in use)"}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[12.5px]">
          <input
            type="radio"
            name={`${titleId}-dur`}
            checked={!hours}
            onChange={() => setHours(false)}
          />{" "}
          All day
        </label>
        <label className="flex items-center gap-1 text-[12.5px]">
          <input
            type="radio"
            name={`${titleId}-dur`}
            checked={hours}
            onChange={() => setHours(true)}
          />{" "}
          Hours
        </label>
        {hours ? (
          <>
            <HalfHourSelect
              value={start}
              onChange={setStart}
              ariaLabel="From"
            />
            –
            <HalfHourSelect
              value={end}
              onChange={setEnd}
              ariaLabel="To"
              min={start}
            />
          </>
        ) : null}
      </div>
      <div className={HINT}>One leave per person per day. Half-hour steps.</div>
      <div className="grid gap-[3px]">
        <label className={LABEL} htmlFor={`${titleId}-note`}>
          Note (optional)
        </label>
        <input
          id={`${titleId}-note`}
          className={INP}
          maxLength={120}
          value={note}
          onChange={(e) => setNote(cleanNote(e.target.value))}
        />
      </div>
      <ErrorBox text={problem ?? error} />
    </LeaveDialogShell>
  );
}
