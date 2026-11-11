import type {
  AfterShiftParams,
  CannotWorkParams,
  CoverageParams,
  DayIndex,
  DaysPerWeekParams,
  ExcludeFromRotationParams,
  FixedShiftParams,
  MaxPerShiftDayParams,
  MaxPerShiftException,
  MinDaysOnShiftParams,
  MinRestParams,
  Rule,
  RuleType,
  ShiftTimesParams,
  WeekendRotationParams,
  WeeklyHoursAlertParams,
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
  // 置顶 118（Annie「Lizzie一周最多一次closing」）。
  {
    type: "max_days_on_shift",
    label: "Maximum days on a shift",
    hint: "Someone works a shift at most N days a week",
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
    type: "max_per_shift_day",
    label: "Max people on a shift",
    hint: "At most N people on a shift each day",
  },
  {
    type: "exclude_from_rotation",
    label: "Exclude from rotation",
    hint: "Not in the weekend rotation or the filler shifts",
  },
  {
    type: "weekly_hours_alert",
    label: "Weekly hours alert",
    hint: "Show an alert when someone is over N hours in a week",
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
      // 置顶 110 ③：固定班和周末轮值都算进天数。
      return `${who === "everyone" ? "Everyone" : who} ${verb} ${p.mode === "exactly" ? "exactly" : "at most"} ${p.n} day${p.n === 1 ? "" : "s"} a week (fixed shifts and the weekend rotation count)`;
    }
    case "min_days_on_shift": {
      const p = rule.params as unknown as MinDaysOnShiftParams;
      const who = minDaysWho(p);
      const many =
        who.mode === "everyone" || who.mode === "except" || who.ids.length > 1;
      const subject =
        who.mode === "everyone"
          ? "Everyone"
          : who.mode === "except"
            ? `Everyone except ${names(ctx, who.ids)}`
            : names(ctx, who.ids);
      return `${subject} work${many && who.mode === "only" ? "" : "s"} at least ${p.n} ${shiftLabel(ctx, p.shift_type)} day${p.n === 1 ? "" : "s"} per ${p.per === "week" ? "week" : "4 weeks"}`;
    }
    case "max_days_on_shift": {
      const p = rule.params as unknown as MinDaysOnShiftParams;
      const who = minDaysWho(p);
      const many =
        who.mode === "everyone" || who.mode === "except" || who.ids.length > 1;
      const subject =
        who.mode === "everyone"
          ? "Everyone"
          : who.mode === "except"
            ? `Everyone except ${names(ctx, who.ids)}`
            : names(ctx, who.ids);
      return `${subject} work${many && who.mode === "only" ? "" : "s"} at most ${p.n} ${shiftLabel(ctx, p.shift_type)} day${p.n === 1 ? "" : "s"} a week`;
    }
    case "max_per_shift_day": {
      const p = rule.params as unknown as MaxPerShiftDayParams;
      const shift = p.shift_type
        ? shiftLabel(ctx, p.shift_type)
        : "Every shift";
      const when =
        p.days && p.days.length ? `on ${describeDays(p.days)}` : "every day";
      return `${shift}: at most ${p.max} ${p.max === 1 ? "person" : "people"} a day, ${when}`;
      // 例外另起一行显示（rules-view / rule-dialog 用 describeExceptions）。
    }
    case "weekly_hours_alert": {
      const p = rule.params as unknown as WeeklyHoursAlertParams;
      return `Show an alert when someone is scheduled over ${p.hours} hours in a week (alert only, nothing is blocked)`;
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

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-11-26" → "Nov 26"。 */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * Max people 的例外，一条一句（置顶 110 续）：「Close: at most 2 on Nov 26」「Every shift: at most 2 on Dec 20 – Jan 5」；
 * 最后一天早于 today 的标 past（题 5 A：灰掉、留着）。
 */
export function describeExceptions(
  p: MaxPerShiftDayParams,
  ctx: DescribeContext,
  today: string,
): { text: string; past: boolean }[] {
  return (p.exceptions ?? []).map((x: MaxPerShiftException) => {
    const shift = x.shift_type ?? p.shift_type;
    const when =
      x.to && x.to !== x.from
        ? `${shortDate(x.from)} – ${shortDate(x.to)}`
        : shortDate(x.from);
    return {
      text: `${shift ? shiftLabel(ctx, shift) : "Every shift"}: at most ${x.max} on ${when}`,
      past: (x.to || x.from) < today,
    };
  });
}

/** 「某种班至少几天」选的是谁（置顶 110 题 7）：旧规则的 employee_id 当成 Only these people。 */
export function minDaysWho(p: MinDaysOnShiftParams): {
  mode: "everyone" | "only" | "except";
  ids: number[];
} {
  if (p.employee_ids && p.employee_ids.length)
    return { mode: "only", ids: p.employee_ids };
  if (p.employee_id != null) return { mode: "only", ids: [p.employee_id] };
  if (p.exclude_employee_ids && p.exclude_employee_ids.length)
    return { mode: "except", ids: p.exclude_employee_ids };
  return { mode: "everyone", ids: [] };
}

/** 这条规则提到了哪些班次类型（停用提醒用，置顶 85 Q4）。 */
export function shiftKeysOfRule(rule: Rule): string[] {
  const p = rule.params as Record<string, unknown>;
  const keys: unknown[] = [p.shift_type, p.if_worked, p.then_cannot];
  if (Array.isArray(p.slots))
    for (const s of p.slots as { shift_type?: unknown }[])
      keys.push(s?.shift_type);
  return [...new Set(keys.filter((k): k is string => typeof k === "string"))];
}

/** 开着的、用到这个班次类型的规则（停用的类型 Auto-fill 照规则还会排，要提醒去改规则）。 */
export function enabledRulesUsingShift(rules: Rule[], key: string): Rule[] {
  return rules.filter((r) => r.enabled && shiftKeysOfRule(r).includes(key));
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
    case "max_days_on_shift":
      return { employee_ids: [firstEmp], shift_type: firstShift, n: 1 };
    case "min_rest":
      return { hours: 12 };
    case "after_shift":
      return { if_worked: firstShift, then_cannot: firstShift };
    case "coverage":
      return { shift_type: firstShift, min: 1 };
    case "exclude_from_rotation":
      return { employee_id: firstEmp };
    case "max_per_shift_day":
      // 不写 shift_type = Every shift（Annie「每个班一天只能有一个人」）。
      return { max: 1 };
    case "weekly_hours_alert":
      return { hours: 40 };
  }
}

const dayOverlap = (a?: number[], b?: number[]) =>
  !a || !a.length || !b || !b.length || a.some((d) => b.includes(d));

/**
 * 两条规则互相打架（置顶 110 题 8 A）：后端不判，页面在两条规则下面各写一行琥珀字、存的时候也提示，不拦。
 * - Coverage 至少 N 人 > 同一种班、日子有重叠的 Max people 最多 M 人；
 * - 同一种班、日子有重叠的两条 Max people（数字不同）：Auto-fill 用小的那个。
 * 只看开着的规则。返回 规则 id → 要显示的句子。
 */
export function ruleConflicts(
  rules: Rule[],
  ctx: DescribeContext,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string | undefined, text: string) => {
    if (!id) return;
    const list = out.get(id) ?? [];
    if (!list.includes(text)) list.push(text);
    out.set(id, list);
  };
  const on = rules.filter((r) => r.enabled);
  const maxes = on.filter((r) => r.type === "max_per_shift_day");
  for (const cov of on.filter((r) => r.type === "coverage")) {
    const c = cov.params as unknown as CoverageParams;
    for (const m of maxes) {
      const p = m.params as unknown as MaxPerShiftDayParams;
      if (p.shift_type && p.shift_type !== c.shift_type) continue;
      if (!dayOverlap(c.days, p.days) || c.min <= p.max) continue;
      const shift = shiftLabel(ctx, c.shift_type);
      add(
        cov.id,
        `Conflicts with “Max people on a shift” (at most ${p.max} ${shift}). Auto-fill places at most ${p.max} and lists the shortfall.`,
      );
      add(m.id, `Conflicts with “Coverage” (at least ${c.min} ${shift}).`);
    }
  }
  for (let i = 0; i < maxes.length; i++) {
    for (let j = i + 1; j < maxes.length; j++) {
      const a = maxes[i].params as unknown as MaxPerShiftDayParams;
      const b = maxes[j].params as unknown as MaxPerShiftDayParams;
      if (a.max === b.max) continue;
      if (a.shift_type && b.shift_type && a.shift_type !== b.shift_type)
        continue;
      if (!dayOverlap(a.days, b.days)) continue;
      const [big, small] = a.max > b.max ? [maxes[i], b] : [maxes[j], a];
      const bigP = big.params as unknown as MaxPerShiftDayParams;
      const shift = bigP.shift_type
        ? shiftLabel(ctx, bigP.shift_type)
        : small.shift_type
          ? shiftLabel(ctx, small.shift_type)
          : "this shift";
      const when =
        bigP.days && bigP.days.length ? ` on ${describeDays(bigP.days)}` : "";
      add(
        big.id,
        `Another rule also limits ${shift}${when}. Auto-fill uses the smaller number (${small.max}).`,
      );
    }
  }
  return out;
}
