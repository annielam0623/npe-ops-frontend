"use client";

import { useState } from "react";

import { dayBars, gapsOf, overlapsOf } from "@/lib/schedule-timeline";
import { gapDayLabel, gapReason, gapsByDate } from "@/lib/schedule-gaps";
import { formatClock, minutesOf } from "@/lib/schedule-time";
import { shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleGap,
  ScheduleShiftType,
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
  /** 换天（点日期键 / 点「Other days」里的日子）；外部管 selectedDate 时要给。 */
  onSelectDate?: (date: string) => void;
  /**
   * 后端算好的整周空档（`ScheduleWeek.gaps`）。给了就以它为准：日期键标红点、底下写「Gaps on 这天」+「Other days」、
   * 有空档的那天时间轴多一行红色 Nobody。不给就照旧只按这一天的时段自己算。
   */
  weekGaps?: ScheduleGap[];
  /** 空档提示只给能改排班的人看（Annie Q3：staff 看不到）。false 时不出红点、Nobody 行和 Gaps 那一句。 */
  showGaps?: boolean;
  /** 写空档原因用（Unassigned 里的班叫什么）。 */
  shiftTypes?: ScheduleShiftType[];
}

function percentOf(min: number, startMin: number, endMin: number): number {
  return ((min - startMin) / (endMin - startMin)) * 100;
}

/** 红点（未处理 = 红点，全站规矩）。 */
function RedDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 rounded-full bg-red-500", className)}
    />
  );
}

export function DayTimeline({
  weekStart,
  slots,
  employees,
  workWindow,
  selectedDate,
  defaultDate,
  onSelectDate,
  weekGaps,
  showGaps = true,
  shiftTypes = [],
}: DayTimelineProps) {
  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const [internalDate, setInternalDate] = useState(defaultDate ?? dates[1]);
  const date = selectedDate ?? internalDate;
  const select = (d: string) => {
    setInternalDate(d);
    onSelectDate?.(d);
  };

  const windowStart = minutesOf(workWindow.start_time) ?? 0;
  const windowEnd = minutesOf(workWindow.end_time) ?? 24 * 60;

  const bars = dayBars(slots, employees, date);
  const overlaps = overlapsOf(bars);
  const byDate = weekGaps ? gapsByDate(weekGaps) : null;
  /** 这一天的空档（分钟）：有后端的就用后端的，否则照旧自己算。 */
  const gaps = byDate
    ? (byDate.get(date) ?? []).map((g) => ({
        startMin: minutesOf(g.start_time) ?? 0,
        endMin: minutesOf(g.end_time) ?? 0,
        gap: g as ScheduleGap | null,
      }))
    : gapsOf(bars, windowStart, windowEnd).map((g) => ({ ...g, gap: null }));
  const otherDays = byDate ? [...byDate.keys()].filter((d) => d !== date) : [];
  const nobodyRows = showGaps && byDate ? gaps : [];

  return (
    <div>
      <div
        className="mb-3 flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Day"
      >
        {dates.map((d, i) => {
          const hasGap = showGaps && !!byDate?.has(d);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === date}
              data-day-tab={d}
              data-has-gap={hasGap || undefined}
              onClick={() => select(d)}
              title={hasGap ? "This day has a gap in coverage" : undefined}
              className={cn(
                "relative cursor-pointer rounded-[7px] border px-2.5 py-1 text-[12px] font-medium transition",
                d === date
                  ? "border-sky-400/50 bg-sky-400/15 text-sky-300"
                  : "border-white/10 bg-white/[.03] text-white/55 hover:bg-white/[.06]",
              )}
            >
              {DAY_LABELS[i]} {d.slice(5).replace("-", "/")}
              {hasGap ? (
                <RedDot className="absolute -top-1 -right-1 size-2.5 ring-2 ring-[#111a2a]" />
              ) : null}
            </button>
          );
        })}
      </div>

      {bars.length === 0 && nobodyRows.length === 0 ? (
        <p className="text-[13px] text-white/40">
          Nobody is scheduled with usable times on this day.
        </p>
      ) : (
        <div className="space-y-1.5">
          {nobodyRows.map((g, i) => {
            const left = percentOf(
              Math.max(g.startMin, windowStart),
              windowStart,
              windowEnd,
            );
            const width =
              percentOf(Math.min(g.endMin, windowEnd), windowStart, windowEnd) -
              left;
            return (
              <div
                key={`nobody-${i}`}
                data-nobody-row
                className="flex items-center gap-2"
              >
                <div className="w-[88px] shrink-0 truncate text-[12px] font-semibold text-red-300">
                  Nobody
                </div>
                <div className="relative h-5 flex-1 rounded-[4px] bg-white/[.04]">
                  <div
                    className="absolute top-0 h-full rounded-[4px] bg-red-500/45 ring-1 ring-red-400/70"
                    style={{
                      left: `${Math.max(0, left)}%`,
                      width: `${Math.max(0, Math.min(100, width))}%`,
                    }}
                  />
                </div>
                <div className="w-[128px] shrink-0 text-right text-[11px] text-red-300">
                  {formatClock(minutesToHHMM(g.startMin))} –{" "}
                  {formatClock(minutesToHHMM(g.endMin))}
                </div>
              </div>
            );
          })}
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
        {showGaps ? (
          <div data-gaps-line>
            {/* 说清楚是哪一天（Annie：别让人去找问题在哪里）：只写「none」会被当成整周都没问题。 */}
            <span className="font-semibold text-white/70">
              {byDate ? `Gaps on ${gapDayLabel(date)}: ` : "Gaps: "}
            </span>
            {gaps.length === 0 ? (
              <span className="text-emerald-300">
                {byDate ? "none" : "none — fully covered"}
              </span>
            ) : (
              gaps.map((g, i) => (
                <span key={i} className="text-red-300">
                  Nobody on {formatClock(minutesToHHMM(g.startMin))}–
                  {formatClock(minutesToHHMM(g.endMin))}
                  {g.gap ? (
                    <span data-gap-reason className="text-white/45">
                      {" "}
                      ({gapReason(g.gap, slots, shiftTypes)})
                    </span>
                  ) : null}
                  {i < gaps.length - 1 ? ", " : ""}
                </span>
              ))
            )}
            {otherDays.length ? (
              <span data-other-days className="ml-3 text-red-300">
                · Other days:{" "}
                {otherDays.map((d, i) => (
                  <span key={d}>
                    <button
                      type="button"
                      onClick={() => select(d)}
                      className="cursor-pointer font-semibold text-red-200 underline decoration-red-400/60 underline-offset-2"
                    >
                      {gapDayLabel(d)} ›
                    </button>
                    {i < otherDays.length - 1 ? ", " : ""}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
