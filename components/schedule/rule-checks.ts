import {
  exceptionsOn,
  maxPeopleOn,
  roundHours,
  type Rule,
  shiftHours,
  weeklyHoursLimit,
} from "@/lib/schedule-engine";
import type {
  ScheduleEmployee,
  ScheduleShiftType,
  ScheduleSlot,
} from "@/types";

import type { SlotMark } from "./week-draft";

export interface RuleChecks {
  /** 日期 → 超了人数上限的班（列头琥珀一行「Close 2 (max 1)」）。 */
  overByDate: Map<
    string,
    { type: string; label: string; count: number; max: number }[]
  >;
  /** 落在超人数格子里的班（班卡琥珀框）。 */
  overSlot: Set<number>;
  /** 日期 → 那天生效的例外（列头灰字「max 2 today」，题 7 A）。 */
  exceptionByDate: Map<string, { label: string | null; max: number }[]>;
  /** 员工 id → 这周几小时（只放超过提醒小时数的人）。 */
  overHours: Map<number, number>;
}

const EMPTY: RuleChecks = {
  overByDate: new Map(),
  overSlot: new Set(),
  exceptionByDate: new Map(),
  overHours: new Map(),
};

/**
 * 手动排班照规则标出来、不拦（置顶 110 题 3 / 题 6，Annie「手动排班不拦，标出『这天 Close 有 2 人』」）。
 * 只看派了人的班、去掉页面上已删（还没存）的；小时数上班到下班整段算，休假不在班里不算（题 5）。
 */
export function ruleChecks(
  rules: Rule[] | undefined,
  weekStart: string,
  slots: ScheduleSlot[],
  employees: ScheduleEmployee[],
  marks: Map<number, SlotMark> | undefined,
  shiftTypes: ScheduleShiftType[],
): RuleChecks {
  if (!rules || !rules.some((r) => r.enabled)) return EMPTY;
  const on = rules.filter((r) => r.enabled);
  const shown = new Set(employees.map((e) => e.id));
  const live = slots.filter(
    (s) =>
      s.employee_id != null &&
      shown.has(s.employee_id) &&
      !marks?.get(s.id)?.deleted,
  );
  const dayOf = (date: string) =>
    Math.round(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) /
        86400000,
    );

  const overByDate: RuleChecks["overByDate"] = new Map();
  const overSlot = new Set<number>();
  const groups = new Map<string, ScheduleSlot[]>();
  for (const s of live) {
    const k = `${s.date}|${s.shift_type}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const [k, list] of groups) {
    const [date, type] = k.split("|");
    const d = dayOf(date);
    if (d < 0 || d > 6) continue;
    const max = maxPeopleOn(on, date, type);
    const count = new Set(list.map((s) => s.employee_id)).size;
    if (max == null || count <= max) continue;
    const label = shiftTypes.find((t) => t.key === type)?.label ?? type;
    overByDate.set(date, [
      ...(overByDate.get(date) ?? []),
      { type, label, count, max },
    ]);
    for (const s of list) overSlot.add(s.id);
  }

  const exceptionByDate: RuleChecks["exceptionByDate"] = new Map();
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.parse(`${weekStart}T00:00:00Z`) + d * 86400000)
      .toISOString()
      .slice(0, 10);
    const list = exceptionsOn(on, date).map((x) => ({
      label: x.shift_type
        ? (shiftTypes.find((t) => t.key === x.shift_type)?.label ??
          x.shift_type)
        : null,
      max: x.max,
    }));
    if (list.length) exceptionByDate.set(date, list);
  }

  const overHours = new Map<number, number>();
  const limit = weeklyHoursLimit(on);
  if (limit != null) {
    const sum = new Map<number, number>();
    for (const s of live) {
      const id = s.employee_id!;
      sum.set(id, (sum.get(id) ?? 0) + shiftHours(s.start_time, s.end_time));
    }
    for (const [id, h] of sum) if (h > limit) overHours.set(id, roundHours(h));
  }
  return { overByDate, overSlot, exceptionByDate, overHours };
}
