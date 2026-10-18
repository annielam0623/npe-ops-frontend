"use client";

import { useState } from "react";

import { dayBars, gapsOf, overlapsOf } from "@/lib/schedule-timeline";
import { formatClock, minutesOf } from "@/lib/schedule-time";
import { shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleSlot,
  ScheduleWorkWindow,
} from "@/types";

import { DAY_LABELS } from "./config";

interface DayTimelineProps {
  weekStart: string;
  slots: ScheduleSlot[];
  employees: ScheduleEmployee[];
  workWindow: ScheduleWorkWindow;
  /** 外部已经选了要看哪天（例如点了有空档的日子）时传入；不传就自己管理、默认今天在这一周里的那天或周一。 */
  selectedDate?: string;
  defaultDate?: string;
}

function percentOf(min: number, startMin: number, endMin: number): number {
  return ((min - startMin) / (endMin - startMin)) * 100;
}

export function DayTimeline({
  weekStart,
  slots,
  employees,
  workWindow,
  selectedDate,
  defaultDate,
}: DayTimelineProps) {
  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const [internalDate, setInternalDate] = useState(defaultDate ?? dates[1]);
  const date = selectedDate ?? internalDate;

  const windowStart = minutesOf(workWindow.start_time) ?? 0;
  const windowEnd = minutesOf(workWindow.end_time) ?? 24 * 60;

  const bars = dayBars(slots, employees, date);
  const overlaps = overlapsOf(bars);
  const gaps = gapsOf(bars, windowStart, windowEnd);

  return (
    <div>
      <div
        className="mb-3 flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Day"
      >
        {dates.map((d, i) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === date}
            onClick={() => setInternalDate(d)}
            className={cn(
              "cursor-pointer rounded-[7px] border px-2.5 py-1 text-[12px] font-medium transition",
              d === date
                ? "border-sky-400/50 bg-sky-400/15 text-sky-300"
                : "border-white/10 bg-white/[.03] text-white/55 hover:bg-white/[.06]",
            )}
          >
            {DAY_LABELS[i]} {d.slice(5).replace("-", "/")}
          </button>
        ))}
      </div>

      {bars.length === 0 ? (
        <p className="text-[13px] text-white/40">
          Nobody is scheduled with usable times on this day.
        </p>
      ) : (
        <div className="space-y-1.5">
          {bars.map((bar) => {
            const left = percentOf(
              Math.max(bar.startMin, windowStart),
              windowStart,
              windowEnd,
            );
            const width =
              percentOf(
                Math.min(bar.endMin, windowEnd),
                windowStart,
                windowEnd,
              ) - left;
            return (
              <div
                key={`${bar.employee.id}:${bar.slot.id}`}
                className="flex items-center gap-2"
              >
                <div className="w-[88px] shrink-0 truncate text-[12px] text-white/70">
                  {bar.employee.name}
                </div>
                <div className="relative h-5 flex-1 rounded-[4px] bg-white/[.04]">
                  <div
                    className="absolute top-0 h-full rounded-[4px] bg-sky-400/40"
                    style={{
                      left: `${Math.max(0, left)}%`,
                      width: `${Math.max(0, Math.min(100, width))}%`,
                    }}
                    title={`${formatClock(bar.slot.start_time)} – ${formatClock(bar.slot.end_time)}`}
                  />
                </div>
                <div className="w-[128px] shrink-0 text-right text-[11px] text-white/40">
                  {formatClock(bar.slot.start_time)} –{" "}
                  {formatClock(bar.slot.end_time)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-[12px]">
        <div>
          <span className="font-semibold text-white/70">Overlap: </span>
          {overlaps.length === 0 ? (
            <span className="text-white/35">none</span>
          ) : (
            overlaps.map((o, i) => (
              <span key={i} className="text-sky-300">
                {o.employeeA.name} + {o.employeeB.name}{" "}
                {formatClock(minutesToHHMM(o.startMin))}–
                {formatClock(minutesToHHMM(o.endMin))}
                {i < overlaps.length - 1 ? ", " : ""}
              </span>
            ))
          )}
        </div>
        <div>
          <span className="font-semibold text-white/70">Gaps: </span>
          {gaps.length === 0 ? (
            <span className="text-emerald-300">none — fully covered</span>
          ) : (
            gaps.map((g, i) => (
              <span key={i} className="text-red-300">
                Nobody on {formatClock(minutesToHHMM(g.startMin))}–
                {formatClock(minutesToHHMM(g.endMin))}
                {i < gaps.length - 1 ? ", " : ""}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
