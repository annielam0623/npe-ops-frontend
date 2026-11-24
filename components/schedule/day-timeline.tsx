"use client";

import { useLayoutEffect, useRef, useState } from "react";

import {
  coversGaps,
  dayBars,
  gapsOf,
  overlapsOf,
} from "@/lib/schedule-timeline";
import { gapDayLabel, gapReason, gapsByDate } from "@/lib/schedule-gaps";
import { formatClock, minutesOf } from "@/lib/schedule-time";
import type { HoursOf } from "@/lib/schedule-work-hours";
import { shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleGap,
  ScheduleShiftType,
  ScheduleSlot,
} from "@/types";

import { DAY_LABELS } from "./config";

interface DayTimelineProps {
  weekStart: string;
  slots: ScheduleSlot[];
  employees: ScheduleEmployee[];
  /** 那一天的 Working hours（按星期几，Annie 2026-11-02）；off = No coverage needed，这天不查空档。 */
  hoursOf: HoursOf;
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
  /** 洛杉矶的此刻（日期 + 第几分钟）：看的是今天时画一条「now」竖线。 */
  now?: { date: string; minute: number };
}

function percentOf(min: number, startMin: number, endMin: number): number {
  return ((min - startMin) / (endMin - startMin)) * 100;
}

/** 刻度上的钟点：整点写「2 AM」，不是整点写「9:30 PM」。 */
function axisLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * 时间条上面那一行刻度（Annie 2026-11-02「时间条上面应该有个时间线显示时间的」，preview PnnAHTzhtSGD1nQcZmiWzu）：
 * 两头写 Working hours 的开始和结束，中间每 step 小时一个整点；离两头或「now」太近的不写，免得叠在一起。
 */
function axisTicks(
  startMin: number,
  endMin: number,
  stepHours: number,
  nowMin: number | null,
): number[] {
  const step = stepHours * 60;
  const minGap = step * 0.6;
  const out: number[] = [];
  for (let m = Math.ceil((startMin + 1) / step) * step; m < endMin; m += step) {
    if (m - startMin < minGap || endMin - m < minGap) continue;
    if (nowMin != null && Math.abs(m - nowMin) < minGap) continue;
    out.push(m);
  }
  return out;
}

/** 刻度字之间至少留这么宽（px），再近就当叠在一起。 */
const AXIS_LABEL_GAP = 6;

/**
 * 刻度那一行。两头（Working hours 的开始 / 结束）和「now」一定写；中间的整点照实际量出来的位置，
 * 离两头、now 或前一个整点太近就藏起来（Annie 2026-11-23「时间刻度重叠那个修一下」：半屏时「8 PM」和「9:30 PM」叠成「8 P9:30 PM」）。
 * 藏用 visibility，不占别的位置；窗口宽度变了重新量。
 */
function AxisRow({
  stepHours,
  className,
  windowStart,
  windowEnd,
  nowMin,
}: {
  stepHours: number;
  className: string;
  windowStart: number;
  windowEnd: number;
  nowMin: number | null;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<number[]>([]);
  const ticks = axisTicks(windowStart, windowEnd, stepHours, nowMin);
  const ticksKey = ticks.join(",");

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      if (row.offsetWidth === 0) return; // 这一行在这个屏宽下藏着（电脑 / 手机各一行）
      const box = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      const fixed = [
        box(row.querySelector("[data-axis-start]")),
        box(row.querySelector("[data-axis-end]")),
        box(row.querySelector("[data-now-label]")),
      ].filter((b): b is { left: number; right: number } => b !== null);
      const hit = (
        a: { left: number; right: number },
        b: { left: number; right: number },
      ) =>
        a.left < b.right + AXIS_LABEL_GAP && b.left < a.right + AXIS_LABEL_GAP;
      const shown: { left: number; right: number }[] = [];
      const next: number[] = [];
      row.querySelectorAll<HTMLElement>("[data-axis-tick]").forEach((el) => {
        const b = box(el)!;
        if (fixed.some((f) => hit(b, f)) || shown.some((s) => hit(b, s))) {
          next.push(Number(el.dataset.axisTick));
        } else {
          shown.push(b);
        }
      });
      setHidden((prev) => (prev.join(",") === next.join(",") ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [ticksKey, windowStart, windowEnd, nowMin]);

  const label =
    "font-mono text-[10.5px] leading-4 whitespace-nowrap text-white/55";
  return (
    <div
      ref={rowRef}
      data-axis-step={stepHours}
      className={cn("relative h-4 flex-1", className)}
    >
      <span data-axis-start className={cn("absolute left-0", label)}>
        {axisLabel(windowStart)}
      </span>
      {ticks.map((m) => {
        const off = hidden.includes(m);
        return (
          <span
            key={m}
            data-axis-tick={m}
            data-axis-hidden={off ? "" : undefined}
            aria-hidden={off || undefined}
            className={cn(
              "absolute -translate-x-1/2",
              label,
              off && "invisible",
            )}
            style={{ left: `${percentOf(m, windowStart, windowEnd)}%` }}
          >
            {axisLabel(m)}
          </span>
        );
      })}
      <span data-axis-end className={cn("absolute right-0", label)}>
        {axisLabel(windowEnd)}
      </span>
      {nowMin != null ? (
        <span
          data-now-label
          className="absolute -translate-x-1/2 bg-[#111a2a] px-1 font-mono text-[10.5px] leading-4 font-bold whitespace-nowrap text-amber-300"
          style={{ left: `${percentOf(nowMin, windowStart, windowEnd)}%` }}
        >
          now {axisLabel(nowMin)}
        </span>
      ) : null}
    </div>
  );
}

/** 每一行底下每小时一条淡竖线，对着上面的刻度看。 */
function HourLines({ startMin, endMin }: { startMin: number; endMin: number }) {
  const lines: number[] = [];
  for (let m = Math.ceil((startMin + 1) / 60) * 60; m < endMin; m += 60)
    lines.push(m);
  return (
    <>
      {lines.map((m) => (
        <span
          key={m}
          aria-hidden
          data-hour-line
          className="absolute inset-y-0 w-px bg-white/[.07]"
          style={{ left: `${percentOf(m, startMin, endMin)}%` }}
        />
      ))}
    </>
  );
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
  hoursOf,
  selectedDate,
  defaultDate,
  onSelectDate,
  weekGaps,
  showGaps = true,
  shiftTypes = [],
  now,
}: DayTimelineProps) {
  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const [internalDate, setInternalDate] = useState(defaultDate ?? dates[1]);
  const date = selectedDate ?? internalDate;
  const select = (d: string) => {
    setInternalDate(d);
    onSelectDate?.(d);
  };

  const dayHours = hoursOf(date);
  const windowStart = minutesOf(dayHours.start_time) ?? 0;
  const windowEnd = minutesOf(dayHours.end_time) ?? 24 * 60;

  const allBars = dayBars(slots, employees, date);
  // 不算值班人头的人（Annie 2026-11-02「我已经说过Anite不参加gap，为什么她的时间仍然出来在时间条里」，preview ①A）：
  // 能改排班的人看的时间条里不出现、Overlap 也不算，底下灰字一句（②A）。员工看的照常（⑤A，员工界面不显示这个说明）。
  const hidden = (e: ScheduleEmployee) =>
    showGaps && !e.is_test && !coversGaps(e);
  const bars = allBars.filter((b) => !hidden(b.employee));
  const notShown = allBars.filter((b) => hidden(b.employee));
  const overlaps = overlapsOf(bars);
  const byDate = weekGaps ? gapsByDate(weekGaps) : null;
  /** 这一天的空档（分钟）：有后端的就用后端的，否则照旧自己算。 */
  const gaps = byDate
    ? (byDate.get(date) ?? []).map((g) => ({
        startMin: minutesOf(g.start_time) ?? 0,
        endMin: minutesOf(g.end_time) ?? 0,
        gap: g as ScheduleGap | null,
      }))
    : dayHours.off
      ? []
      : gapsOf(bars, windowStart, windowEnd).map((g) => ({ ...g, gap: null }));
  const otherDays = byDate ? [...byDate.keys()].filter((d) => d !== date) : [];
  const nobodyRows = showGaps && byDate ? gaps : [];
  // 刻度和每小时竖线只在 Working hours 不跨午夜时画（跨午夜的窗口条子本来也画不对，另说）。
  const axisOk = windowEnd > windowStart;
  // 「now」竖线：看的是今天、现在在 Working hours 里（③A）。
  const nowMin =
    axisOk &&
    now &&
    now.date === date &&
    now.minute > windowStart &&
    now.minute < windowEnd
      ? now.minute
      : null;
  const track = (inner: React.ReactNode) => (
    <div className="relative h-5 flex-1 rounded-[4px] bg-white/[.04]">
      {axisOk ? <HourLines startMin={windowStart} endMin={windowEnd} /> : null}
      {inner}
      {nowMin != null ? (
        <span
          aria-hidden
          data-now-line
          className="absolute -inset-y-0.5 w-0.5 rounded-[1px] bg-amber-400"
          style={{ left: `${percentOf(nowMin, windowStart, windowEnd)}%` }}
        />
      ) : null}
    </div>
  );
  const axisRow = (stepHours: number, className: string) => (
    <AxisRow
      key={stepHours}
      stepHours={stepHours}
      className={className}
      windowStart={windowStart}
      windowEnd={windowEnd}
      nowMin={nowMin}
    />
  );

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
          {axisOk ? (
            <div data-time-axis className="flex items-center gap-2">
              <div className="w-[88px] shrink-0" />
              {axisRow(2, "max-sm:hidden")}
              {axisRow(4, "sm:hidden")}
              <div className="w-[128px] shrink-0" />
            </div>
          ) : null}
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
                {track(
                  <div
                    className="absolute top-0 h-full rounded-[4px] bg-red-500/45 ring-1 ring-red-400/70"
                    style={{
                      left: `${Math.max(0, left)}%`,
                      width: `${Math.max(0, Math.min(100, width))}%`,
                    }}
                  />,
                )}
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
                data-timeline-row={bar.employee.id}
                className="flex items-center gap-2"
              >
                <div className="w-[88px] shrink-0 truncate text-[12px] text-white/70">
                  {bar.employee.name}
                </div>
                {track(
                  <div
                    className="absolute top-0 h-full rounded-[4px] bg-sky-400/40"
                    style={{
                      left: `${Math.max(0, left)}%`,
                      width: `${Math.max(0, Math.min(100, width))}%`,
                    }}
                    title={`${formatClock(bar.slot.start_time)} – ${formatClock(bar.slot.end_time)}`}
                  />,
                )}
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
            {dayHours.off ? (
              <span data-no-coverage className="text-white/45">
                none — no coverage needed on this day
              </span>
            ) : gaps.length === 0 ? (
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
        {notShown.length ? (
          <div data-not-shown className="text-white/45">
            Not shown (don&apos;t count toward coverage):{" "}
            {notShown
              .map(
                (b) =>
                  `${b.employee.name} ${formatClock(b.slot.start_time)} – ${formatClock(b.slot.end_time)}`,
              )
              .join(", ")}
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
