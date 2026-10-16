"use client";

import { formatRange, hasBadTimeRange } from "@/lib/schedule-time";
import { shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  ScheduleCell,
  ScheduleEmployee,
  ScheduleGap,
  ScheduleShiftType,
} from "@/types";

import { DAY_LABELS, shiftColorClass } from "./config";

interface WeekGridProps {
  weekStart: string;
  employees: ScheduleEmployee[];
  cells: ScheduleCell[];
  shiftTypes: ScheduleShiftType[];
  gaps: ScheduleGap[];
  /** supervisor 及以上才能点格子编辑；staff 只读。 */
  canEdit: boolean;
  onCellClick?: (employee: ScheduleEmployee, date: string) => void;
}

function shiftLabel(
  key: string | null,
  shiftTypes: ScheduleShiftType[],
): string {
  if (!key) return "—";
  return shiftTypes.find((t) => t.key === key)?.label ?? key;
}

export function WeekGrid({
  weekStart,
  employees,
  cells,
  shiftTypes,
  gaps,
  canEdit,
  onCellClick,
}: WeekGridProps) {
  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const cellByKey = new Map(
    cells.map((c) => [`${c.employee_id}:${c.date}`, c]),
  );
  const gapDates = new Set(gaps.map((g) => g.date));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="sticky left-0 border-b border-white/10 bg-[#0e1b2c] px-3 py-2 text-left text-[11px] font-semibold text-white/55 uppercase">
              Employee
            </th>
            {dates.map((date, i) => (
              <th
                key={date}
                className="border-b border-white/10 px-2 py-2 text-center text-[11px] font-semibold text-white/55 uppercase"
              >
                <div>{DAY_LABELS[i]}</div>
                <div className="font-normal text-white/35 normal-case">
                  {date.slice(5).replace("-", "/")}
                </div>
                {gapDates.has(date) ? (
                  <div
                    className="mx-auto mt-1 h-1.5 w-1.5 rounded-full bg-red-400"
                    title="Has a coverage gap"
                  />
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr key={employee.id} className="border-b border-white/[.06]">
              <td className="sticky left-0 bg-[#0b1724] px-3 py-2 font-medium text-white/85">
                {employee.name}
              </td>
              {dates.map((date) => {
                const cell = cellByKey.get(`${employee.id}:${date}`) ?? null;
                const bad = hasBadTimeRange(
                  cell?.start_time ?? null,
                  cell?.end_time ?? null,
                );
                return (
                  <td key={date} className="px-1.5 py-1.5 text-center">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onCellClick?.(employee, date)}
                      className={cn(
                        "w-full cursor-pointer rounded-[8px] px-2 py-1.5 text-left transition",
                        !canEdit && "cursor-default",
                        bad
                          ? "border border-amber-400/50 bg-amber-400/15"
                          : "border border-transparent hover:bg-white/[.04]",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold",
                          shiftColorClass(cell?.shift_type ?? null),
                        )}
                      >
                        {shiftLabel(cell?.shift_type ?? null, shiftTypes)}
                      </span>
                      <div className="mt-1 text-[11px] text-white/60">
                        {formatRange(
                          cell?.start_time ?? null,
                          cell?.end_time ?? null,
                        )}
                      </div>
                      {cell?.note ? (
                        <div className="mt-0.5 truncate text-[10.5px] text-white/35">
                          {cell.note}
                        </div>
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
