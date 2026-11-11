"use client";

import { Fragment, useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { shiftYmd } from "@/lib/la-date";
import { fetchScheduleWeek } from "@/lib/schedule-api";
import {
  type DayIndex,
  type DayShift,
  type Rule,
  type WeekPlan,
  coverageMinOn,
  findViolations,
  maxPeopleOn,
  overHours,
  roundHours,
  shiftHours,
  weeklyTargetDays,
} from "@/lib/schedule-engine";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleShiftType,
  ScheduleWeek,
} from "@/types";

import {
  CARD,
  CARD_HEADER,
  DAY_LABELS,
  MUTED,
  personDotColor,
  shiftCardClass,
} from "./config";
import { type DescribeContext, describeRule, minDaysWho } from "./rules";
import { OffCard } from "./week-grid";

/**
 * 置顶 119（Annie「我需要在staff schedule那里把排班做成你preview的那个样子，一目了然，还可以分析」→「3个问题都同意A，动手」；
 * 样稿 https://claude.ai/artifact/8vLNnqptWW3ddFvfNoVAvk）：Staff Schedule 的 Overview 标签，只看和分析，不写任何数据。
 * - 一人一行、一天一格（班次色同排班页，Off 灰卡、Leave 深黄卡），默认 4 周、可切 1 周、‹ › 翻；
 * - 每人每周最后一格几天几小时（跟 Days per week 对不上红字）；每周下面每种班每天几个人（少于 Coverage / 多于 Max people 红）；
 * - Analysis：Rules 逐条每周 ✓ / ✗（判断用 lib/schedule-engine.ts 的 findViolations / overHours，不另写一套），
 *   每种班没人的日子、排不下的班，每人这几周合计。不收进 ⋯ / i（Annie 114「我不要任何隐藏菜单」）。
 */

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; prev: ScheduleWeek | null; weeks: ScheduleWeek[] };

interface WeekCalc {
  ws: string;
  plan: WeekPlan;
  prevPlan: WeekPlan | null;
  /** 员工 id → 这一周哪几天休假（0 = 周日）。 */
  leave: Record<number, DayIndex[]>;
  status: string;
}

function dayIndex(weekStart: string, date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) /
      86_400_000,
  );
}

function planFromWeek(
  week: ScheduleWeek,
  employees: ScheduleEmployee[],
): WeekPlan {
  const byEmployee: Record<number, DayShift[]> = {};
  for (const e of employees) byEmployee[e.id] = new Array(7).fill(null);
  for (const s of week.slots) {
    if (s.employee_id == null || !byEmployee[s.employee_id]) continue;
    const d = dayIndex(week.week_start, s.date);
    if (d < 0 || d > 6 || byEmployee[s.employee_id][d]) continue;
    byEmployee[s.employee_id][d] = {
      type: s.shift_type,
      start: s.start_time,
      end: s.end_time,
    };
  }
  return { weekStart: week.week_start, byEmployee };
}

function leaveFromWeek(week: ScheduleWeek): Record<number, DayIndex[]> {
  const out: Record<number, DayIndex[]> = {};
  for (const t of week.time_off ?? []) {
    const d = dayIndex(week.week_start, t.date);
    if (d < 0 || d > 6) continue;
    (out[t.employee_id] ??= []).push(d as DayIndex);
  }
  return out;
}

function md(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
}

function rangeLabel(start: string, weeks: number): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const end = shiftYmd(start, weeks * 7 - 1);
  return `${fmt(start)} – ${fmt(end)}, ${end.slice(0, 4)}`;
}

/** 规则里只管「怎么排」、不是一条能查对错的（Shift times / 周末轮值 / 不参加轮换）。 */
const NOT_A_CHECK = new Set([
  "shift_times",
  "weekend_rotation",
  "exclude_from_rotation",
]);

type Mark = { ok: boolean | null; notes: string[] };

export function OverviewView({
  initialStart,
  employees,
  shiftTypes,
  rules,
  onUnauthorized,
}: {
  /** 排班页现在看的那一周（周日）。 */
  initialStart: string;
  /** 排班表里的人（已按页面顺序排好、只含在职的）。 */
  employees: ScheduleEmployee[];
  shiftTypes: ScheduleShiftType[];
  /** null = 规则接口没上线：只出排班表，不出逐条规则。 */
  rules: Rule[] | null;
  onUnauthorized: () => void;
}) {
  const [start, setStart] = useState(initialStart);
  const [count, setCount] = useState<1 | 4>(4);
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    (async () => {
      try {
        // 前一周也读：跨周的「下班到第二天上班」要看上周最后一天。按顺序读（同 Auto-fill）。
        const prev = await fetchScheduleWeek(
          shiftYmd(start, -7),
          controller.signal,
        ).catch((e: unknown) => {
          if (isStatus(e, 401)) throw e;
          return null;
        });
        const weeks: ScheduleWeek[] = [];
        for (let i = 0; i < count; i++)
          weeks.push(
            await fetchScheduleWeek(shiftYmd(start, i * 7), controller.signal),
          );
        if (!controller.signal.aborted) setLoad({ kind: "ready", prev, weeks });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorized();
          return;
        }
        setLoad({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [start, count, onUnauthorized]);

  const typeOf = (key: string) => shiftTypes.find((t) => t.key === key);
  const labelOf = (key: string) => typeOf(key)?.label ?? key;
  const activeTypes = shiftTypes.filter((t) => t.is_active !== false);
  const engineEmps = employees.map((e) => ({ id: e.id, name: e.name }));
  const enabledRules = (rules ?? []).filter((r) => r.enabled);
  const timesRules = enabledRules.filter((r) => r.type === "shift_times");
  const ctx: DescribeContext = { employees, shiftTypes };

  const calcs: WeekCalc[] =
    load.kind === "ready"
      ? load.weeks.map((w, i) => ({
          ws: w.week_start,
          plan: planFromWeek(w, employees),
          prevPlan:
            i === 0
              ? load.prev
                ? planFromWeek(load.prev, employees)
                : null
              : planFromWeek(load.weeks[i - 1], employees),
          leave: leaveFromWeek(w),
          status: w.status,
        }))
      : [];

  /** 一条规则在一周里对不对（判断全用引擎的）。null = 这种规则不是能查对错的。 */
  function markOf(rule: Rule, c: WeekCalc): Mark {
    if (NOT_A_CHECK.has(rule.type)) return { ok: null, notes: [] };
    if (rule.type === "weekly_hours_alert") {
      const over = overHours([rule], c.plan, engineEmps);
      return {
        ok: over.length === 0,
        notes: over.map((o) => `${o.name} ${o.hours} h`),
      };
    }
    if (
      rule.type === "min_days_on_shift" ||
      (rule.type as string) === "max_days_on_shift"
    ) {
      const p = rule.params as {
        shift_type: string;
        n: number;
        per?: "week" | "4weeks";
        employee_id?: number;
        employee_ids?: number[];
        exclude_employee_ids?: number[];
      };
      if (rule.type === "min_days_on_shift" && p.per === "4weeks")
        return { ok: null, notes: [] };
      // max_days_on_shift（置顶 118，还在分支上）：规则里有就查，没有也不报错。
      const who = minDaysWho({ ...p, per: p.per ?? "week" });
      const notes: string[] = [];
      for (const e of employees) {
        if (who.mode === "only" && !who.ids.includes(e.id)) continue;
        if (who.mode === "except" && who.ids.includes(e.id)) continue;
        const n = (c.plan.byEmployee[e.id] ?? []).filter(
          (s) => s?.type === p.shift_type,
        ).length;
        if (rule.type === "min_days_on_shift" ? n < p.n : n > p.n)
          notes.push(`${e.name} ${n} ${labelOf(p.shift_type)}`);
      }
      return { ok: notes.length === 0, notes };
    }
    const v = findViolations(
      [...timesRules, rule],
      c.plan,
      c.prevPlan,
      engineEmps,
      c.leave,
    );
    return { ok: v.length === 0, notes: v };
  }

  const checkRules = enabledRules.filter((r) => r.type !== "shift_times");

  return (
    <section data-schedule-overview className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Previous weeks"
          onClick={() => setStart((s) => shiftYmd(s, -count * 7))}
          className={NAV}
        >
          ‹
        </button>
        <span
          data-overview-range
          className="min-w-[180px] text-center text-[14px] font-bold text-white"
        >
          {rangeLabel(start, count)}
        </span>
        <button
          type="button"
          aria-label="Next weeks"
          onClick={() => setStart((s) => shiftYmd(s, count * 7))}
          className={NAV}
        >
          ›
        </button>
        <span
          className="ml-2 inline-flex gap-1"
          role="radiogroup"
          aria-label="How many weeks"
        >
          {([1, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={count === n}
              data-overview-count={n}
              onClick={() => setCount(n)}
              className={cn(PILL, count === n && PILL_ON)}
            >
              {n === 1 ? "1 week" : "4 weeks"}
            </button>
          ))}
        </span>
      </div>

      <Legend types={activeTypes} />

      {load.kind === "loading" ? (
        <p className={cn(MUTED, "text-[13px]")}>Loading…</p>
      ) : load.kind === "error" ? (
        <p role="alert" className="text-[13px] text-red-300">
          Could not load the schedule: {load.message}
        </p>
      ) : (
        <>
          {calcs.map((c) => (
            <WeekBlock
              key={c.ws}
              c={c}
              employees={employees}
              types={activeTypes}
              rules={enabledRules}
              labelOf={labelOf}
            />
          ))}

          <div data-overview-analysis className={cn(CARD, "min-w-0 p-4")}>
            <h2 className={CARD_HEADER}>
              Analysis · {rangeLabel(start, count)}
            </h2>
            <div className="mt-2 overflow-x-auto">
              <table className="border-separate border-spacing-[2px] text-[12.5px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-[#0d1b2e]" />
                    {calcs.map((c) => (
                      <th
                        key={c.ws}
                        className="px-3 py-1 text-center font-semibold text-white/80"
                      >
                        {md(c.ws)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules === null ? (
                    <tr>
                      <td
                        className={cn(MUTED, "px-2 py-1")}
                        colSpan={calcs.length + 1}
                      >
                        Rules are not available yet.
                      </td>
                    </tr>
                  ) : checkRules.length === 0 ? (
                    <tr>
                      <td
                        className={cn(MUTED, "px-2 py-1")}
                        colSpan={calcs.length + 1}
                      >
                        No rules are turned on.
                      </td>
                    </tr>
                  ) : (
                    checkRules.map((r, i) => (
                      <tr key={r.id ?? i} data-overview-rule={r.type}>
                        <th className="sticky left-0 z-10 max-w-[420px] min-w-[260px] bg-[#0d1b2e] px-2 py-1 text-left font-normal whitespace-normal text-white/85">
                          {describeRule(r, ctx)}
                        </th>
                        {calcs.map((c) => {
                          const m = markOf(r, c);
                          return (
                            <td
                              key={c.ws}
                              data-mark={
                                m.ok === null ? "na" : m.ok ? "ok" : "no"
                              }
                              className={cn(
                                "rounded-[4px] px-3 py-1 text-center font-bold",
                                m.ok === null
                                  ? "text-white/40"
                                  : m.ok
                                    ? "bg-emerald-400/10 text-emerald-300"
                                    : "bg-red-500/15 text-red-300",
                              )}
                            >
                              {m.ok === null ? "—" : m.ok ? "✓" : "✗"}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                  {activeTypes.map((t) => (
                    <tr key={`none-${t.key}`} data-overview-empty-type={t.key}>
                      <th className="sticky left-0 z-10 bg-[#0d1b2e] px-2 py-1 text-left font-normal text-white/85">
                        Days with nobody on {t.label}
                      </th>
                      {calcs.map((c) => {
                        const days = [0, 1, 2, 3, 4, 5, 6].filter(
                          (d) =>
                            !employees.some(
                              (e) =>
                                c.plan.byEmployee[e.id]?.[d]?.type === t.key,
                            ),
                        );
                        return (
                          <td
                            key={c.ws}
                            className="px-3 py-1 text-center text-white/80"
                          >
                            {days.length === 7
                              ? "Every day"
                              : days.map((d) => DAY_LABELS[d]).join(", ") ||
                                "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr data-overview-unfilled>
                    <th className="sticky left-0 z-10 bg-[#0d1b2e] px-2 py-1 text-left font-normal text-white/85">
                      Shifts that could not be filled (fewer people than
                      Coverage)
                    </th>
                    {calcs.map((c) => {
                      const short = unfilled(
                        c,
                        employees,
                        enabledRules,
                        labelOf,
                      );
                      return (
                        <td
                          key={c.ws}
                          className={cn(
                            "rounded-[4px] px-3 py-1 text-center",
                            short.length
                              ? "bg-red-500/15 font-bold text-red-300"
                              : "text-emerald-300",
                          )}
                        >
                          {short.length ? short.join(", ") : "None"}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <Details
              calcs={calcs}
              rules={checkRules}
              markOf={markOf}
              ctx={ctx}
            />
          </div>

          <PersonTotals
            calcs={calcs}
            employees={employees}
            types={activeTypes}
            range={rangeLabel(start, count)}
          />
        </>
      )}
    </section>
  );
}

const NAV =
  "h-8 w-8 cursor-pointer rounded-[9px] border border-white/16 bg-white/[.04] text-[15px] leading-none text-[#cbd5e1] hover:bg-white/[.09]";
const PILL =
  "cursor-pointer rounded-[8px] border border-white/16 px-3 py-1 text-[12.5px] font-semibold text-[#cbd5e1] hover:bg-white/[.07]";
const PILL_ON = "border-white/40 bg-white/[.14] text-white";

function Legend({ types }: { types: ScheduleShiftType[] }) {
  return (
    <div
      data-overview-legend
      className="flex flex-wrap items-center gap-2 text-[12px] text-white/80"
    >
      {types.map((t) => (
        <span
          key={t.key}
          className={cn(
            "rounded-[6px] border px-2 py-0.5 font-bold",
            shiftCardClass(t.key),
          )}
        >
          {t.label}
        </span>
      ))}
      <span className="rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-2 py-0.5 font-bold text-[#fde68a]">
        Off
      </span>
      <span className="rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] px-2 py-0.5 font-bold text-[#fde68a]">
        Leave
      </span>
    </div>
  );
}

function WeekBlock({
  c,
  employees,
  types,
  rules,
  labelOf,
}: {
  c: WeekCalc;
  employees: ScheduleEmployee[];
  types: ScheduleShiftType[];
  rules: Rule[];
  labelOf: (key: string) => string;
}) {
  const dates = DAY_LABELS.map((_, i) => shiftYmd(c.ws, i));
  return (
    <div data-overview-week={c.ws} className={cn(CARD, "min-w-0 p-3")}>
      <div className="mb-2 flex items-baseline gap-2">
        <b className="text-[14px] text-white">
          {md(c.ws)} – {md(dates[6])}
        </b>
        <span className="rounded-[10px] border border-white/15 px-2 text-[11px] text-white/70">
          {c.status === "published" ? "Published" : "Draft"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#0d1b2e]" />
              {dates.map((d, i) => (
                <th
                  key={d}
                  className="min-w-[92px] pb-1 text-center text-white/90"
                >
                  <div className="text-[11px] font-bold tracking-[.06em] uppercase">
                    {DAY_LABELS[i]}
                  </div>
                  <div className="font-mono text-[10px] text-white/70">
                    {md(d)}
                  </div>
                </th>
              ))}
              <th className="min-w-[64px] pb-1 text-center text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
                Week
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const days = c.plan.byEmployee[e.id] ?? [];
              const leave = c.leave[e.id] ?? [];
              const worked = days.filter(Boolean).length;
              const hours = roundHours(
                days.reduce(
                  (n, s) => (s ? n + shiftHours(s.start, s.end) : n),
                  0,
                ),
              );
              const target = weeklyTargetDays(rules, e.id, new Set(leave).size);
              const wrong = target != null && worked !== target;
              return (
                <tr key={e.id} data-overview-person={e.id}>
                  <th className="sticky left-0 z-10 bg-[#0d1b2e] pr-2 text-left">
                    <span className="flex min-h-[44px] items-center gap-[7px] rounded-[6px] bg-[#0b1727] px-2 text-[13.5px] font-bold whitespace-nowrap text-white">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: personDotColor(e.id) }}
                      />
                      {e.name}
                    </span>
                  </th>
                  {dates.map((d, i) => {
                    const s = days[i];
                    return (
                      <td
                        key={d}
                        data-overview-cell={`${e.id}|${d}`}
                        className="p-0"
                      >
                        {s ? (
                          <div
                            className={cn(
                              "flex min-h-[44px] flex-col justify-center gap-0.5 rounded-[6px] border px-2 py-1 leading-tight",
                              shiftCardClass(s.type),
                            )}
                          >
                            <b className="text-[12px]">{labelOf(s.type)}</b>
                            <span className="font-mono text-[10px] font-semibold whitespace-nowrap text-white">
                              {formatClock(s.start)} – {formatClock(s.end)}
                            </span>
                          </div>
                        ) : leave.includes(i as DayIndex) ? (
                          <div
                            data-overview-leave
                            className="flex min-h-[44px] items-center rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] px-2 text-[12.5px] font-bold text-[#fde68a]"
                          >
                            Leave
                          </div>
                        ) : (
                          <div className="flex min-h-[44px]">
                            <OffCard />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td
                    data-overview-week-sum={e.id}
                    data-wrong={wrong || undefined}
                    title={
                      target != null ? `Should be ${target} days` : undefined
                    }
                    className="px-2 text-center text-[11px] text-white/70"
                  >
                    <b
                      className={cn(
                        "text-[13.5px]",
                        wrong ? "text-red-300" : "text-white",
                      )}
                    >
                      {worked}
                    </b>{" "}
                    d
                    <br />
                    {hours} h
                    {wrong ? (
                      <span className="block text-[10.5px] font-semibold text-red-300">
                        should be {target}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {types.map((t) => (
              <tr key={t.key} data-overview-count-row={t.key}>
                <th className="sticky left-0 z-10 bg-[#0d1b2e] pr-2 text-left text-[11.5px] font-normal whitespace-nowrap text-white/70">
                  {t.label}
                </th>
                {dates.map((d, i) => {
                  const n = employees.filter(
                    (e) => c.plan.byEmployee[e.id]?.[i]?.type === t.key,
                  ).length;
                  const min = coverageMinOn(rules, i as DayIndex, t.key);
                  const max = maxPeopleOn(rules, d, t.key);
                  const bad = n < min || (max != null && n > max);
                  return (
                    <td
                      key={d}
                      data-overview-count={`${t.key}|${d}`}
                      data-bad={bad || undefined}
                      className={cn(
                        "rounded-[4px] text-center text-[11.5px]",
                        bad
                          ? "bg-red-500/15 font-bold text-red-300"
                          : "text-white/60",
                      )}
                    >
                      {n}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 每天每种班比 Coverage 要的少的（「Sat Close」）。 */
function unfilled(
  c: WeekCalc,
  employees: ScheduleEmployee[],
  rules: Rule[],
  labelOf: (key: string) => string,
): string[] {
  const out: string[] = [];
  const types = new Set(
    rules
      .filter((r) => r.type === "coverage")
      .map((r) => (r.params as { shift_type: string }).shift_type),
  );
  for (let d = 0; d < 7; d++) {
    for (const t of types) {
      const n = employees.filter(
        (e) => c.plan.byEmployee[e.id]?.[d]?.type === t,
      ).length;
      if (n < coverageMinOn(rules, d as DayIndex, t))
        out.push(`${DAY_LABELS[d]} ${labelOf(t)}`);
    }
  }
  return out;
}

/** ✗ 的原因直接列出来（不藏在鼠标悬停里）。 */
function Details({
  calcs,
  rules,
  markOf,
  ctx,
}: {
  calcs: WeekCalc[];
  rules: Rule[];
  markOf: (r: Rule, c: WeekCalc) => Mark;
  ctx: DescribeContext;
}) {
  const items: { key: string; week: string; rule: string; notes: string[] }[] =
    [];
  for (const c of calcs)
    rules.forEach((r, i) => {
      const m = markOf(r, c);
      if (m.ok === false)
        items.push({
          key: `${c.ws}-${i}`,
          week: c.ws,
          rule: describeRule(r, ctx),
          notes: m.notes,
        });
    });
  if (!items.length)
    return (
      <p data-overview-all-ok className="mt-2 text-[13px] text-emerald-300">
        Every rule is met in these weeks.
      </p>
    );
  return (
    <ul
      data-overview-details
      className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-red-200"
    >
      {items.map((x) => (
        <li key={x.key}>
          <b>Week of {md(x.week)}</b> — {x.rule}:{" "}
          {x.notes.slice(0, 4).join("; ")}
          {x.notes.length > 4 ? ` (+${x.notes.length - 4} more)` : ""}
        </li>
      ))}
    </ul>
  );
}

function PersonTotals({
  calcs,
  employees,
  types,
  range,
}: {
  calcs: WeekCalc[];
  employees: ScheduleEmployee[];
  types: ScheduleShiftType[];
  range: string;
}) {
  return (
    <div data-overview-totals className={cn(CARD, "min-w-0 p-4")}>
      <h2 className={CARD_HEADER}>Per person · {range}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[12.5px]">
          <thead>
            <tr className="text-white/70">
              <th className="sticky left-0 z-10 bg-[#0d1b2e]" />
              <th className="px-3">Days</th>
              <th className="px-3">Hours</th>
              {types.map((t) => (
                <th key={t.key} className="px-3 whitespace-nowrap">
                  {t.label}
                </th>
              ))}
              <th className="px-3 whitespace-nowrap">Weekend days</th>
              <th className="px-3">Leave</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              let days = 0;
              let hours = 0;
              let weekend = 0;
              let leave = 0;
              const byType = new Map<string, number>();
              for (const c of calcs) {
                leave += new Set(c.leave[e.id] ?? []).size;
                (c.plan.byEmployee[e.id] ?? []).forEach((s, d) => {
                  if (!s) return;
                  days++;
                  hours += shiftHours(s.start, s.end);
                  if (d === 0 || d === 6) weekend++;
                  byType.set(s.type, (byType.get(s.type) ?? 0) + 1);
                });
              }
              return (
                <tr
                  key={e.id}
                  data-overview-total={e.id}
                  className="text-center text-white/85"
                >
                  <th className="sticky left-0 z-10 bg-[#0d1b2e] pr-3 text-left font-bold whitespace-nowrap text-white">
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: personDotColor(e.id) }}
                    />
                    {e.name}
                  </th>
                  <td>{days}</td>
                  <td>{roundHours(hours)}</td>
                  {types.map((t) => (
                    <Fragment key={t.key}>
                      <td>{byType.get(t.key) ?? 0}</td>
                    </Fragment>
                  ))}
                  <td>{weekend}</td>
                  <td>{leave || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
