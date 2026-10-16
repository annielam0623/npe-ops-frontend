import { minutesOf } from "@/lib/schedule-time";
import type { ScheduleCell, ScheduleEmployee } from "@/types";

export interface TimelineBar {
  employee: ScheduleEmployee;
  cell: ScheduleCell;
  startMin: number;
  endMin: number;
}

export interface TimelineOverlap {
  employeeA: ScheduleEmployee;
  employeeB: ScheduleEmployee;
  startMin: number;
  endMin: number;
}

/**
 * Day timeline 用：某一天每个人的班次区间（Off、没填时间、下班不晚于上班的格子都没有可画的区间）。
 * 跨 23:59 的情况不处理（班次应该落在工作时段内，不支持跨夜——同任务包范围）。
 */
export function dayBars(
  cells: readonly ScheduleCell[],
  employees: readonly ScheduleEmployee[],
  date: string,
): TimelineBar[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const bars: TimelineBar[] = [];
  for (const cell of cells) {
    if (cell.date !== date) continue;
    const employee = byId.get(cell.employee_id);
    if (!employee) continue;
    const startMin = minutesOf(cell.start_time);
    const endMin = minutesOf(cell.end_time);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    bars.push({ employee, cell, startMin, endMin });
  }
  return bars.sort((a, b) => a.startMin - b.startMin);
}

/** 两两找重叠区间（同一个人跟自己不算）；同一对人如果有多段重叠，分别列出。 */
export function overlapsOf(bars: readonly TimelineBar[]): TimelineOverlap[] {
  const overlaps: TimelineOverlap[] = [];
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i];
      const b = bars[j];
      if (a.employee.id === b.employee.id) continue;
      const startMin = Math.max(a.startMin, b.startMin);
      const endMin = Math.min(a.endMin, b.endMin);
      if (startMin < endMin) {
        overlaps.push({
          employeeA: a.employee,
          employeeB: b.employee,
          startMin,
          endMin,
        });
      }
    }
  }
  return overlaps.sort((x, y) => x.startMin - y.startMin);
}

/**
 * 工作时段内没有任何人覆盖的空档（纯前端算，给 Day timeline 即时显示用；发布拦截以服务端
 * `ScheduleWeek.gaps` 为准，两边算法应该一致，但以防万一服务端优先）。
 */
export function gapsOf(
  bars: readonly TimelineBar[],
  windowStartMin: number,
  windowEndMin: number,
): { startMin: number; endMin: number }[] {
  const covered = bars
    .map(
      (b) =>
        [
          Math.max(b.startMin, windowStartMin),
          Math.min(b.endMin, windowEndMin),
        ] as const,
    )
    .filter(([s, e]) => s < e)
    .sort((a, b) => a[0] - b[0]);

  const gaps: { startMin: number; endMin: number }[] = [];
  let cursor = windowStartMin;
  for (const [s, e] of covered) {
    if (s > cursor)
      gaps.push({ startMin: cursor, endMin: Math.min(s, windowEndMin) });
    cursor = Math.max(cursor, e);
  }
  if (cursor < windowEndMin)
    gaps.push({ startMin: cursor, endMin: windowEndMin });
  return gaps;
}
