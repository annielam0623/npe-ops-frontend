import type {
  AfterShiftParams,
  CannotWorkParams,
  CoverageParams,
  DayIndex,
  DaysPerWeekParams,
  ExcludeFromRotationParams,
  FixedShiftParams,
  MinDaysOnShiftParams,
  MinRestParams,
  Rule,
  RuleType,
  ShiftTimesParams,
  WeekendRotationParams,
} from "@/lib/schedule-engine";
import { formatClock } from "@/lib/schedule-time";
import type { ScheduleEmployee, ScheduleShiftType } from "@/types";

import { DAY_LABELS } from "./config";

/** 加规则时能选的类型（顺序 = 下拉里的顺序；文字是员工看得懂的，不是系统名）。 */
export const RULE_TYPES: { type: RuleType; label: string; hint: string }[] = [
  {
    type: "weekend_rotation",
    label: "Weekend rotation",
    hint: "Take turns on the weekend shifts",
  },
  {
    type: "cannot_work",
    label: "Cannot work",
    hint: "Someone can't work certain days or a certain shift",
  },
  {
    type: "fixed_shift",
    label: "Fixed shift",
    hint: "Someone always works the same shift on certain days",
  },
  {
    type: "days_per_week",
    label: "Days per week",
    hint: "Exactly or at most N days a week",
  },
  {
    type: "min_days_on_shift",
    label: "Minimum days on a shift",
    hint: "Someone works a shift at least N days",
  },
  {
    type: "min_rest",
    label: "Rest between shifts",
    hint: "At least N hours between two shifts",
  },
  {
    type: "after_shift",
    label: "After a shift",
    hint: "After shift A, no shift B the next day",
  },
  {
    type: "coverage",
    label: "Coverage",
    hint: "At least N people on a shift every day",
  },
  {
    type: "exclude_from_rotation",
    label: "Exclude from rotation",
    hint: "Not in the weekend rotation or the filler shifts",
  },
  {
    type: "shift_times",
    label: "Shift times",
    hint: "Start and end time for a shift (used by Auto-fill)",
  },
];

export function newRuleId(): string {
  return `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface DescribeContext {
  employees: ScheduleEmployee[];
  shiftTypes: ScheduleShiftType[];
}

function empName(ctx: DescribeContext, id: number | undefined): string {
  if (id == null) return "Everyone";
  return ctx.employees.find((e) => e.id === id)?.name ?? `#${id}`;
}

function shiftLabel(ctx: DescribeContext, key: string): string {
  return ctx.shiftTypes.find((t) => t.key === key)?.label ?? key;
}

/** [1,2,3,4,5] → "Mon–Fri"；[6] → "Sat"；7 个 → "every day"。 */
export function describeDays(days: DayIndex[] | undefined): string {
  if (!days || days.length === 0 || days.length === 7) return "every day";
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(
      j - i >= 2
        ? `${DAY_LABELS[sorted[i]]}–${DAY_LABELS[sorted[j]]}`
        : sorted
            .slice(i, j + 1)
            .map((d) => DAY_LABELS[d])
            .join(", "),
    );
    i = j + 1;
  }
  return runs.join(", ");
}

function names(ctx: DescribeContext, ids: number[] | undefined): string {
  if (!ids || ids.length === 0) return "everyone";
  return ids.map((id) => empName(ctx, id)).join(", ");
}

/** 一条规则的一句话说明（Rules 列表里显示）。 */
export function describeRule(rule: Rule, ctx: DescribeContext): string {
  switch (rule.type) {
    case "shift_times": {
      const p = rule.params as unknown as ShiftTimesParams;
      return `${shiftLabel(ctx, p.shift_type)} shifts run ${formatClock(p.start)} – ${formatClock(p.end)}`;
    }
    case "fixed_shift": {
      const p = rule.params as unknown as FixedShiftParams;
      const t =
        p.start && p.end
          ? ` (${formatClock(p.start)} – ${formatClock(p.end)})`
          : "";
      return `${empName(ctx, p.employee_id)} always works ${shiftLabel(ctx, p.shift_type)}${t} on ${describeDays(p.days)}`;
    }
    case "weekend_rotation": {
      const p = rule.params as unknown as WeekendRotationParams;
      const slots = p.slots
        .map((s) => `${DAY_LABELS[s.day]} ${shiftLabel(ctx, s.shift_type)}`)
        .join(", ");
      const only =
        p.exclusive === false ? "" : " Nobody else is scheduled on those days.";
      const who = names(ctx, p.employee_ids);
      return `${slots}. ${who.charAt(0).toUpperCase()}${who.slice(1)} take turns.${only}`;
    }
    case "cannot_work": {
      const p = rule.params as unknown as CannotWorkParams;
      const what = [
        p.shift_type ? shiftLabel(ctx, p.shift_type) : null,
        p.days && p.days.length ? describeDays(p.days) : null,
      ].filter(Boolean);
      return `${empName(ctx, p.employee_id)} cannot work ${what.join(" on ") || "at all"}`;
    }
    case "days_per_week": {
      const p = rule.params as unknown as DaysPerWeekParams;
      const who = names(ctx, p.employee_ids);
      const verb =
        p.employee_ids && p.employee_ids.length > 1 ? "work" : "works";
      return `${who === "everyone" ? "Everyone" : who} ${verb} ${p.mode === "exactly" ? "exactly" : "at most"} ${p.n} day${p.n === 1 ? "" : "s"} a week`;
    }
    case "min_days_on_shift": {
      const p = rule.params as unknown as MinDaysOnShiftParams;
      return `${empName(ctx, p.employee_id)} work${p.employee_id != null ? "s" : ""} at least ${p.n} ${shiftLabel(ctx, p.shift_type)} day${p.n === 1 ? "" : "s"} per ${p.per === "week" ? "week" : "4 weeks"}`;
    }
    case "min_rest": {
      const p = rule.params as unknown as MinRestParams;
      return `At least ${p.hours} hours between two shifts`;
    }
    case "after_shift": {
      const p = rule.params as unknown as AfterShiftParams;
      return `After a ${shiftLabel(ctx, p.if_worked)}, no ${shiftLabel(ctx, p.then_cannot)} the next day`;
    }
    case "coverage": {
      const p = rule.params as unknown as CoverageParams;
      return `${p.days && p.days.length ? describeDays(p.days) : "Every day"} has at least ${p.min} ${shiftLabel(ctx, p.shift_type)}`;
    }
    case "exclude_from_rotation": {
      const p = rule.params as unknown as ExcludeFromRotationParams;
      return `${empName(ctx, p.employee_id)} is not in the rotation`;
    }
  }
}

/** 加一条新规则时表单的起始值。 */
export function defaultParams(
  type: RuleType,
  ctx: DescribeContext,
): Record<string, unknown> {
  const firstEmp = ctx.employees.find((e) => e.is_active)?.id;
  const firstShift = ctx.shiftTypes.find((t) => t.is_active)?.key ?? "open";
  switch (type) {
    case "shift_times":
      return { shift_type: firstShift, start: "08:00", end: "17:00" };
    case "fixed_shift":
      return {
        employee_id: firstEmp,
        days: [1, 2, 3, 4, 5],
        shift_type: firstShift,
      };
    case "weekend_rotation":
      return {
        slots: [
          { day: 6, shift_type: firstShift },
          { day: 0, shift_type: firstShift },
        ],
      };
    case "cannot_work":
      return { employee_id: firstEmp, days: [6] };
    case "days_per_week":
      return { mode: "exactly", n: 5 };
    case "min_days_on_shift":
      return {
        employee_id: firstEmp,
        shift_type: firstShift,
        n: 2,
        per: "week",
      };
    case "min_rest":
      return { hours: 12 };
    case "after_shift":
      return { if_worked: firstShift, then_cannot: firstShift };
    case "coverage":
      return { shift_type: firstShift, min: 1 };
    case "exclude_from_rotation":
      return { employee_id: firstEmp };
  }
}
