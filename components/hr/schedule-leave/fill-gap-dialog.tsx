"use client";

import { useId, useMemo, useState } from "react";

import {
  clock,
  clockRange,
  coverCandidates,
  coverNote,
  coverShiftType,
  dayLabel,
  leaveLine,
} from "@/lib/schedule-leave";
import type { ScheduleGap, ScheduleWeekOp } from "@/types";

import {
  BTN_GREEN,
  BTN_PLAIN,
  HINT,
  LeaveDialogShell,
  MINI_TABLE,
  MINI_TD,
  MINI_TH,
  shiftLabelOf,
  type LeaveDialogData,
} from "./ui";

let fillSeq = 0;

interface FillGapDialogProps {
  data: LeaveDialogData;
  gap: ScheduleGap;
  /** 先选后存：把一个 create op 交给总览的页面草稿，页底 Save 才存（灰绿 Add）。 */
  onStage: (op: Extract<ScheduleWeekOp, { op: "create" }>) => void;
  onClose: () => void;
}

/**
 * 填空档（Q12 A）：选一个那段时间有空的人，给他加一个和空档一样长的班；
 * 班次类型沿用请假那人那一班的类型，备注「Cover for <name>」。空档原因是 nobody 时用当天最常见的班次类型、不写备注。
 * 规则（min_rest 等）前端不算：Save 时后端 409 rule_violation 拦下、总览的框照原话显示（Q4 A）。
 */
export function FillGapDialog({
  data,
  gap,
  onStage,
  onClose,
}: FillGapDialogProps) {
  const titleId = useId();
  const reason = gap.reason;
  const leaver =
    reason?.kind === "leave" && reason.employee_id != null
      ? reason.employee_id
      : null;
  const leaverName = reason?.employee_name ?? null;
  const leave =
    leaver != null
      ? data.timeOff.find(
          (t) => t.employee_id === leaver && t.date === gap.date,
        )
      : undefined;
  const label = (k: string) => shiftLabelOf(data.shiftTypes, k);

  const fallbackType = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of data.slots)
      if (s.date === gap.date)
        count.set(s.shift_type, (count.get(s.shift_type) ?? 0) + 1);
    return (
      [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      data.shiftTypes.find((t) => t.is_active)?.key ??
      "mid"
    );
  }, [data.slots, data.shiftTypes, gap.date]);

  const type =
    leaver != null
      ? coverShiftType(
          leaver,
          gap.date,
          gap.start_time,
          gap.end_time,
          data.slots,
          fallbackType,
        )
      : fallbackType;
  const leaverShift = data.slots.find(
    (s) => s.employee_id === leaver && s.date === gap.date,
  );

  const candidates = useMemo(
    () =>
      coverCandidates(
        gap.date,
        gap.start_time,
        gap.end_time,
        leaver ?? -1,
        data.employees,
        data.slots,
        data.timeOff,
        label,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, gap, leaver],
  );
  const [pick, setPick] = useState<number | null>(
    () => candidates.find((c) => !c.blocked)?.id ?? null,
  );
  const picked = candidates.find((c) => c.id === pick && !c.blocked);
  const published = data.weekStatusOf(gap.date) === "published";
  const note = leaverName ? coverNote(leaverName) : null;

  function add() {
    if (!picked) return;
    fillSeq += 1;
    onStage({
      op: "create",
      ref: `fill${fillSeq}`,
      date: gap.date,
      shift_type: type,
      start_time: gap.start_time,
      end_time: gap.end_time,
      employee_id: picked.id,
      note,
    });
  }

  return (
    <LeaveDialogShell
      titleId={titleId}
      title={`Fill gap · ${dayLabel(gap.date)} ${clockRange(gap.start_time, gap.end_time)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_PLAIN} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            data-fill-add
            className={BTN_GREEN}
            disabled={!picked}
            onClick={add}
          >
            Add to schedule
          </button>
        </>
      }
    >
      <div className="text-[12.5px]">
        Why:{" "}
        <b>
          {leaver != null
            ? `${leaverName ?? "Someone"} ${leave ? leaveLine(leave).replace(/^Leave/, "leave") : `leave (${reason?.leave_kind_label ?? ""})`}`
            : "Nobody is on"}
        </b>
        .
        {leaverShift ? (
          <>
            {" "}
            Their shift that day is {label(leaverShift.shift_type)}{" "}
            {clock(leaverShift.start_time)} – {clock(leaverShift.end_time)}.
          </>
        ) : null}
      </div>
      {candidates.length ? (
        <table className={MINI_TABLE}>
          <thead>
            <tr>
              <th className={MINI_TH} />
              <th className={MINI_TH}>Who</th>
              <th className={MINI_TH}>That day</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr
                key={c.id}
                data-candidate={c.id}
                className={c.blocked ? "text-[#94a3b8]" : ""}
              >
                <td className={MINI_TD}>
                  <input
                    type="radio"
                    name={`${titleId}-who`}
                    aria-label={c.name}
                    disabled={!!c.blocked}
                    checked={pick === c.id}
                    onChange={() => setPick(c.id)}
                  />
                </td>
                <td className={MINI_TD}>
                  {c.blocked ? c.name : <b>{c.name}</b>}
                </td>
                <td className={MINI_TD}>{c.blocked ?? c.thatDay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={HINT}>Nobody else is on the schedule list.</div>
      )}
      {picked ? (
        <div className="text-[12.5px]" data-fill-summary>
          Adds{" "}
          <b>
            {label(type)} {clockRange(gap.start_time, gap.end_time)}
          </b>{" "}
          for {picked.name}
          {note ? (
            <>
              , note <b>“{note}”</b>
            </>
          ) : null}
          .
        </div>
      ) : null}
      {published ? (
        <div className={HINT}>
          This week is published. After Save, use Send to confirm so{" "}
          {picked?.name ?? "they"} get{picked ? "s" : ""} the change.
        </div>
      ) : null}
    </LeaveDialogShell>
  );
}
