"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";
import { laToday, shiftYmd, weekStartYmd } from "@/lib/la-date";
import { fetchScheduleWeek, setScheduleTimeOff } from "@/lib/schedule-api";
import { bulkCreateSlots } from "@/lib/schedule-rules-api";
import {
  generateWeek,
  seedFromBase,
  type DayIndex,
  type DayShift,
  type Problem,
  type Rule,
  type WeekPlan,
  overHours,
  weeklyHoursLimit,
} from "@/lib/schedule-engine";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleSettings,
  ScheduleTimeOff,
  ScheduleWeek,
} from "@/types";

import {
  DAY_LABELS,
  personDotColor,
  shiftCardClass,
  TIME_OFF_LABEL,
} from "./config";
import { type DescribeContext, describeRule } from "./rules";
import { OffCard } from "./week-grid";

/** 往前看几周当「历史」（周末轮值接着往下排、跨周休息间隔用）。 */
const HISTORY_WEEKS = 4;

type Mode = "replace" | "append";

/** 怎么填：照 Rules 排（原来的 Auto-fill）／拿一周当基础照抄，再按 Rules 修正（Annie 2026-11-02）。 */
type Fill = "rules" | "base";

/** 按基础周排：最多排几周（preview 题 ② A：默认 4 周，可选 1–6 周）。 */
const BASE_MAX_WEEKS = 6;

/** 深色弹窗里的下拉（同 Rules 页的选择框）。 */
const SELECT =
  "h-8 rounded-[8px] border border-white/20 bg-[#0b1727] px-2 text-[12.5px] text-white";

interface WeekInfo {
  weekStart: string;
  published: boolean;
  existingSlots: number;
  /** 这一周是后端第一次打开时自动复制上一周来的（copied_from）：按基础周排时当空周，整周换掉。 */
  copied: boolean;
  /** 已发布 / 或者要保留的班（Add to them 时当 locked）。 */
  plan: WeekPlan;
  /** 置顶 117：这一周已经存好的休假（PTO / Sick / Personal）。 */
  timeOff: ScheduleTimeOff[];
}

interface Proposal {
  weekStart: string;
  skipped: boolean;
  plan: WeekPlan;
  /** 要新建的班（Replace = 整周；Add = 只有新排的）。 */
  create: {
    employeeId: number;
    date: string;
    type: string;
    start: string;
    end: string;
  }[];
  problems: Problem[];
  /** 按基础周排：跟基础周不一样的格子（`<员工 id>|<星期几>` → 为什么改）。 */
  changed?: Record<string, string>;
  /** 存的时候先删掉这一周原来的班（按基础周排：复制来的周）；没写 = 照弹窗的 Replace / Add。 */
  replace?: boolean;
  /** 置顶 117：这一周的 Leave 格子（`<员工 id>|<星期几>` → 显示的字：PTO / Sick / Personal / Leave）。 */
  leaveCells?: Record<string, string>;
  /** 置顶 117：排之前服务器上这一周的班（存 Leave 时看那天原来有没有班）。 */
  serverPlan?: WeekPlan;
}

type Step =
  | { kind: "setup" }
  | { kind: "loading"; text: string }
  | {
      kind: "leave";
      weeks: WeekInfo[];
      history: WeekPlan[];
      base: WeekPlan | null;
    }
  | { kind: "decide"; weeks: WeekInfo[]; history: WeekPlan[] }
  | { kind: "preview"; proposals: Proposal[]; seed: number }
  | { kind: "creating" }
  | { kind: "error"; message: string };

interface AutoFillDialogProps {
  /** 排班页现在看的这一周（周日），从这一周开始排。 */
  weekStart: string;
  rules: Rule[];
  employees: ScheduleEmployee[];
  settings: ScheduleSettings;
  onClose: () => void;
  /** 建好草稿：回到排班页刷新 + 提示。 */
  onDone: (message: string) => void;
  /**
   * 当前这一周（排班页正在看的那一周）填出来的班交给页面暂存、等整周 Save（Annie 2026-10-29 B9 Q6）；
   * 后面几周照旧直接建草稿。没传 = 照旧全部直接建。replace = 这一周原来的班要删掉。
   */
  onDraftThisWeek?: (
    made: Proposal["create"],
    replace: boolean,
    /** 置顶 117：那天原来有班、要等整周 Save 删掉旧班后再存的 Leave（员工 id → 日期）。 */
    laterLeave?: Record<number, string[]>,
  ) => void;
  /**
   * Staff Schedule › Period（Annie 2026-11-08「最重要一点，可以选择执行哪些rules」）：排这一段（开始那周 + 周数），
   * 不出「Which weeks」/ 基础周的起止选择；多一张规则清单，取消勾选的这一次不执行（不改 Rules 标签）。
   */
  period?: { start: string; weeks: number; ctx: DescribeContext };
}

function planOf(week: ScheduleWeek, employees: ScheduleEmployee[]): WeekPlan {
  const byEmployee: Record<number, DayShift[]> = {};
  for (const e of employees) byEmployee[e.id] = new Array(7).fill(null);
  for (const s of week.slots) {
    if (s.employee_id == null || !byEmployee[s.employee_id]) continue;
    const d = Math.round(
      (Date.parse(`${s.date}T00:00:00Z`) -
        Date.parse(`${week.week_start}T00:00:00Z`)) /
        86_400_000,
    );
    if (d < 0 || d > 6 || byEmployee[s.employee_id][d]) continue;
    byEmployee[s.employee_id][d] = {
      type: s.shift_type,
      start: s.start_time,
      end: s.end_time,
    };
  }
  return { weekStart: week.week_start, byEmployee };
}

/**
 * Auto-fill：按 Rules 排一周 / 未来 4 周 → 先预览「会这样排」→ 确认才建成草稿（Annie 2026-10-18 看预览说「动手」）。
 * 已发布的周不排（跳过并写明）；这周已经有班时让她选替换 / 追加 / 取消；排不下的不硬排，写明原因。
 * 后端只存规则、整周一次建（bulk）；引擎在前端（lib/schedule-engine.ts）。同一周的请求顺序发。
 */
export function AutoFillDialog({
  weekStart,
  rules,
  employees,
  settings,
  onClose,
  onDone,
  onDraftThisWeek,
  period,
}: AutoFillDialogProps) {
  /** Period 模式下这一次不执行的规则（rules 里的下标）；Shift times 不能取消。 */
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set());
  const titleId = useId();
  const pressedOnBackdropRef = useRef(false);
  const [weeksCount, setWeeksCount] = useState<1 | 4>(1);
  const [mode, setMode] = useState<Mode>("replace");
  // 按基础周排（Annie 2026-11-02「用上周的排班为基数，来自动排班，遵守定好的这些role，然后把整个月的班都排出来」）：
  // 默认基础周 = 上周、从下周起排 4 周（preview https://claude.ai/artifact/L3gCgqBPvDLBxAC2ToDVxp 题 ① ② 推荐）。
  const thisWeek = weekStartYmd(laToday());
  const [fill, setFill] = useState<Fill>("rules");
  const [baseWeek, setBaseWeek] = useState(() => shiftYmd(thisWeek, -7));
  const [baseStart, setBaseStart] = useState(() => shiftYmd(thisWeek, 7));
  const [baseCount, setBaseCount] = useState(4);
  const [step, setStep] = useState<Step>({ kind: "setup" });
  const active = employees.filter((e) => e.is_active);
  /**
   * 置顶 117（Annie「让我选择autofill的时候可以先跳出一个窗口，点击哪些天是已经申请的Leave」）：这次新点的 Leave，
   * 员工 id → 日期。先暂存在弹窗里，排班结果确认（Create draft）时才存进系统（PUT /api/schedule/time-off，记成 PTO）。
   */
  const [newLeave, setNewLeave] = useState<Record<number, string[]>>({});
  const dayIn = (weekStart: string, date: string) =>
    Math.round(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) /
        86_400_000,
    );
  /** 这一周哪些人哪几天休假（已存的 + 这次新点的），给引擎用。 */
  const leaveFor = (w: WeekInfo): Record<number, DayIndex[]> => {
    const out: Record<number, DayIndex[]> = {};
    const add = (id: number, date: string) => {
      const d = dayIn(w.weekStart, date);
      if (d < 0 || d > 6) return;
      (out[id] ??= []).push(d as DayIndex);
    };
    for (const t of w.timeOff) add(t.employee_id, t.date);
    for (const [id, dates] of Object.entries(newLeave))
      for (const date of dates) add(Number(id), date);
    return out;
  };
  /** 预览里 Leave 那几格写什么（已存的照种类，新点的写 Leave）。 */
  const leaveCellsFor = (w: WeekInfo): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const t of w.timeOff)
      out[`${t.employee_id}|${dayIn(w.weekStart, t.date)}`] =
        TIME_OFF_LABEL[t.kind] ?? "Leave"; // 置顶 117：今晚一律 Leave（config 里三种都写 Leave）
    for (const [id, dates] of Object.entries(newLeave))
      for (const date of dates) {
        const d = dayIn(w.weekStart, date);
        if (d >= 0 && d <= 6) out[`${id}|${d}`] = "Leave";
      }
    return out;
  };
  const busy = step.kind === "loading" || step.kind === "creating";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const firstWeek = period
    ? period.start
    : fill === "base"
      ? baseStart
      : weekStart;
  const targetCount = period
    ? period.weeks
    : fill === "base"
      ? baseCount
      : weeksCount;
  const targets = Array.from({ length: targetCount }, (_, i) =>
    shiftYmd(firstWeek, i * 7),
  );
  const usedRules = period
    ? rules.filter((r, i) => r.type === "shift_times" || !skipped.has(i))
    : rules;
  // 班次默认时间（后端正式来源）排在最后，盖过旧的 shift_times 规则。
  const allRules: Rule[] = [
    ...usedRules,
    ...settings.shift_types.flatMap((t): Rule[] =>
      t.default_start_time && t.default_end_time
        ? [
            {
              type: "shift_times",
              enabled: true,
              params: {
                shift_type: t.key,
                start: t.default_start_time,
                end: t.default_end_time,
              },
            },
          ]
        : [],
    ),
  ];

  /** 读各周现状（后端说：生成前必须先 GET；顺序读）。 */
  async function inspect() {
    try {
      setStep({ kind: "loading", text: "Checking the weeks…" });
      const history: WeekPlan[] = [];
      for (let i = HISTORY_WEEKS; i >= 1; i--) {
        const w = await fetchScheduleWeek(shiftYmd(firstWeek, -i * 7));
        history.push(planOf(w, active));
      }
      const weeks: WeekInfo[] = [];
      for (const ws of targets) {
        const w = await fetchScheduleWeek(ws);
        weeks.push({
          weekStart: ws,
          published: w.status === "published",
          existingSlots: w.slots.length,
          copied: !!w.copied_from,
          plan: planOf(w, active),
          timeOff: w.time_off ?? [],
        });
      }
      // 置顶 117：先出 Leave 那一步（已存的休假先列出来、点日期标新的 Leave），再排。
      const base =
        fill === "base"
          ? planOf(await fetchScheduleWeek(baseWeek), active)
          : null;
      setStep({ kind: "leave", weeks, history, base });
    } catch (error) {
      setStep({ kind: "error", message: describeError(error) });
    }
  }

  /** Leave 那一步按 Continue：照原来的流程往下走。 */
  function afterLeave(s: Extract<Step, { kind: "leave" }>) {
    if (s.base) {
      // 按基础周排：已有草稿的周只填空格（题 ③ A），不问 Replace / Add。
      runBase(s.weeks, s.history, s.base, 1);
      return;
    }
    const hasExisting = s.weeks.some(
      (w) => !w.published && w.existingSlots > 0,
    );
    if (hasExisting)
      setStep({ kind: "decide", weeks: s.weeks, history: s.history });
    else runEngine(s.weeks, s.history, "replace", 1);
  }

  function runEngine(
    weeks: WeekInfo[],
    history: WeekPlan[],
    chosen: Mode,
    seed: number,
  ) {
    setMode(chosen);
    const proposals: Proposal[] = [];
    const hist = [...history];
    let previous: WeekPlan | null = hist[hist.length - 1] ?? null;
    if (previous) hist.pop();
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      if (w.published) {
        proposals.push({
          weekStart: w.weekStart,
          skipped: true,
          plan: w.plan,
          create: [],
          problems: [],
        });
        if (previous) hist.push(previous);
        previous = w.plan;
        continue;
      }
      const locked = chosen === "append" ? w.plan : null;
      const result = generateWeek({
        weekStart: w.weekStart,
        employees: active.map((e) => ({ id: e.id, name: e.name })),
        rules: allRules,
        previous,
        history: [...hist],
        fallbackTimes: {
          start: settings.work_window.start_time,
          end: settings.work_window.end_time,
        },
        seed: seed * 101 + i,
        locked,
        leave: leaveFor(w),
      });
      const create = result.shifts.filter((s) => {
        if (chosen === "replace") return true;
        const l = w.plan.byEmployee[s.employeeId];
        const dayIdx = Math.round(
          (Date.parse(`${s.date}T00:00:00Z`) -
            Date.parse(`${w.weekStart}T00:00:00Z`)) /
            86_400_000,
        );
        return !l?.[dayIdx];
      });
      proposals.push({
        weekStart: w.weekStart,
        skipped: false,
        plan: result.plan,
        create,
        problems: result.problems,
        leaveCells: leaveCellsFor(w),
        serverPlan: w.plan,
      });
      if (previous) hist.push(previous);
      previous = result.plan;
    }
    setStep({ kind: "preview", proposals, seed });
  }

  /**
   * 按基础周排：每一周先照抄基础周（去掉违反规则的格子，`seedFromBase`），锁住，再用同一个引擎按 Rules 补排
   * （周末轮值、覆盖、每周天数）。已发布的周跳过；已有草稿的班原样保留、只填空格；排不下的留空、写明（题 ⑤ A）。
   */
  function runBase(
    weeks: WeekInfo[],
    history: WeekPlan[],
    base: WeekPlan,
    seed: number,
  ) {
    setMode("append");
    const emps = active.map((e) => ({ id: e.id, name: e.name }));
    // Working hours 按星期几（后端 work_hours，没带 = 照旧每天都排）：off 的那天不排、不报空档。
    // 后端 weekday 0 = 周一 … 6 = 周日；排班这边 0 = 周日。
    const offDays = new Set(
      (settings.work_hours?.days ?? [])
        .filter((d) => d.off)
        .map((d) => (d.weekday + 1) % 7),
    );
    const withoutOff = (plan: WeekPlan): WeekPlan => ({
      ...plan,
      byEmployee: Object.fromEntries(
        Object.entries(plan.byEmployee).map(([id, days]) => [
          id,
          days.map((x, d) => (offDays.has(d) ? null : x)),
        ]),
      ),
    });
    const baseOn = offDays.size ? withoutOff(base) : base;
    const proposals: Proposal[] = [];
    const hist = [...history];
    let previous: WeekPlan | null = hist[hist.length - 1] ?? null;
    if (previous) hist.pop();
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      if (w.published) {
        proposals.push({
          weekStart: w.weekStart,
          skipped: true,
          plan: w.plan,
          create: [],
          problems: [],
        });
        if (previous) hist.push(previous);
        previous = w.plan;
        continue;
      }
      // 后端第一次打开某一周会把上一周的班复制过来（copied_from）：那不是 staff 排的，当空周整周按基础周排、存时换掉；
      // 不是复制来的、已经有班的草稿（Auto-fill / 手排）照题 ③ A 只填空格。
      const keep = w.copied ? null : w.plan;
      const { seed: start, dropped } = seedFromBase({
        rules: allRules,
        base: baseOn,
        weekStart: w.weekStart,
        previous,
        employees: emps,
        existing: keep,
        leave: leaveFor(w),
      });
      const result = generateWeek({
        weekStart: w.weekStart,
        employees: emps,
        rules: allRules,
        previous,
        history: [...hist],
        fallbackTimes: {
          start: settings.work_window.start_time,
          end: settings.work_window.end_time,
        },
        seed: seed * 101 + i,
        locked: start,
        leave: leaveFor(w),
      });
      const dayOf = (date: string) =>
        Math.round(
          (Date.parse(`${date}T00:00:00Z`) -
            Date.parse(`${w.weekStart}T00:00:00Z`)) /
            86_400_000,
        );
      const plan = offDays.size ? withoutOff(result.plan) : result.plan;
      const create = result.shifts.filter(
        (s) =>
          !keep?.byEmployee[s.employeeId]?.[dayOf(s.date)] &&
          !offDays.has(dayOf(s.date)),
      );
      const problems = result.problems.filter(
        (x) => !x.date || !offDays.has(dayOf(x.date)),
      );
      const why = new Map(
        dropped.map((x) => [`${x.employeeId}|${x.day}`, x.reason]),
      );
      const changed: Record<string, string> = {};
      for (const e of emps) {
        for (let d = 0; d < 7; d++) {
          if (keep?.byEmployee[e.id]?.[d]) continue;
          if (offDays.has(d)) continue;
          const b = base.byEmployee[e.id]?.[d] ?? null;
          const r = plan.byEmployee[e.id]?.[d] ?? null;
          const same =
            (!b && !r) ||
            (!!b &&
              !!r &&
              b.type === r.type &&
              b.start === r.start &&
              b.end === r.end);
          if (!same)
            changed[`${e.id}|${d}`] = why.get(`${e.id}|${d}`) ?? "Rules";
        }
      }
      proposals.push({
        weekStart: w.weekStart,
        skipped: false,
        plan,
        create,
        problems,
        changed,
        replace: w.copied && w.existingSlots > 0,
        leaveCells: leaveCellsFor(w),
        serverPlan: w.plan,
      });
      if (previous) hist.push(previous);
      previous = plan;
    }
    setStep({ kind: "preview", proposals, seed });
  }

  async function create(proposals: Proposal[]) {
    setStep({ kind: "creating" });
    let made = 0;
    let weeksMade = 0;
    // 置顶 117：新点的 Leave 一周一周存。后端同一人同一天不能既有班又有休假，所以：
    // 直接建草稿的周——先建班（Replace 先删旧班），再存这一周的 Leave；
    // 这一周（班放在页面上等 Save）——那天原来没班的马上存，原来有班、Replace 的交给页面 Save 之后存；
    // Add to them（保留原来的班）又碰上那天原来有班的，存不上，写进结果里。
    const leaveSaved: string[] = [];
    const leaveSkipped: string[] = [];
    const nameOf = (id: number) =>
      employees.find((e) => e.id === id)?.name ?? `#${id}`;
    const leaveOf = (weekStart: string) => {
      const out: Record<number, string[]> = {};
      for (const [id, dates] of Object.entries(newLeave))
        for (const date of dates) {
          const d = dayIn(weekStart, date);
          if (d >= 0 && d <= 6) (out[Number(id)] ??= []).push(date);
        }
      return out;
    };
    const putLeave = async (rec: Record<number, string[]>) => {
      for (const [id, dates] of Object.entries(rec)) {
        if (!dates.length) continue;
        await setScheduleTimeOff({
          employee_id: Number(id),
          dates: [...dates].sort(),
          kind: "pto",
          note: null,
        });
        for (const d of dates) leaveSaved.push(`${nameOf(Number(id))} ${d}`);
      }
    };
    // 当前这一周：放到页面上等整周 Save（B9 Q6），不直接建。
    let onPage = 0;
    try {
      for (const p of proposals) {
        if (p.skipped) continue;
        const replace = p.replace ?? mode === "replace";
        const lv = leaveOf(p.weekStart);
        const had = (id: number, date: string) =>
          !!p.serverPlan?.byEmployee[id]?.[dayIn(p.weekStart, date)];
        const split = (keepIfHad: boolean) => {
          const now: Record<number, string[]> = {};
          const later: Record<number, string[]> = {};
          for (const [k, dates] of Object.entries(lv)) {
            const id = Number(k);
            for (const date of dates) {
              if (!had(id, date)) (now[id] ??= []).push(date);
              else if (replace && keepIfHad) (later[id] ??= []).push(date);
              else if (replace) (now[id] ??= []).push(date);
              else leaveSkipped.push(`${nameOf(id)} ${date}`);
            }
          }
          return { now, later };
        };
        if (onDraftThisWeek && p.weekStart === weekStart) {
          const { now, later } = split(true);
          await putLeave(now);
          onDraftThisWeek(p.create, replace, later);
          for (const [id, dates] of Object.entries(later))
            for (const d of dates)
              leaveSaved.push(
                `${nameOf(Number(id))} ${d} (after you click Save)`,
              );
          onPage = p.create.length;
          continue;
        }
        await bulkCreateSlots(p.weekStart, {
          replace,
          slots: p.create.map((s) => ({
            date: s.date,
            shift_type: s.type,
            start_time: s.start,
            end_time: s.end,
            employee_id: s.employeeId,
          })),
        });
        made += p.create.length;
        weeksMade++;
        // 班建好了（Replace 已经删掉旧班），再存这一周的 Leave。
        await putLeave(split(false).now);
      }
    } catch (error) {
      setStep({
        kind: "error",
        message: `${describeError(error)}${weeksMade ? ` (${weeksMade} week(s) were already created as drafts before this.)` : " Nothing was created."}${leaveSaved.length ? ` Leave already saved: ${leaveSaved.join(", ")}.` : ""}`,
      });
      return;
    }
    const skipped = proposals.filter((p) => p.skipped).length;
    const skippedText = skipped
      ? ` (${skipped} published week${skipped === 1 ? "" : "s"} skipped)`
      : "";
    const pageText = `Put ${onPage} shift${onPage === 1 ? "" : "s"} on this week. Click Save to keep them.`;
    // 置顶 117：Leave 存了几天 / 哪几天存不上（Add to them 保留了原来的班）。
    const leaveText = `${leaveSaved.length ? ` Leave saved: ${leaveSaved.length} day${leaveSaved.length === 1 ? "" : "s"}.` : ""}${leaveSkipped.length ? ` Leave not saved because the shift there was kept: ${leaveSkipped.join(", ")}. Remove that shift, then add the leave on the schedule.` : ""}`;
    onDone(
      (weeksMade
        ? `${onPage ? `${pageText} ` : ""}Created ${made} draft shift${made === 1 ? "" : "s"} for ${weeksMade}${onPage ? " other" : ""} week${weeksMade === 1 ? "" : "s"}${skippedText}. Nothing is published and nobody was notified.`
        : `${pageText}${skippedText ? ` ${skippedText.trim()}.` : ""} Nothing is published and nobody was notified.`) +
        leaveText,
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedOnBackdropRef.current &&
          event.target === event.currentTarget &&
          !busy
        )
          onClose();
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[92vh] w-full max-w-[1180px] flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-[#0d1b2e] p-5 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <h2 id={titleId} className="text-[17px] font-semibold text-white">
          {step.kind === "preview"
            ? `Preview · ${rangeText(firstWeek, targetCount)}`
            : period
              ? `Auto-fill ${rangeText(period.start, period.weeks)}`
              : "Auto-fill schedule"}
        </h2>

        {step.kind === "setup" ? (
          <>
            <p className="text-[13px] text-white/80">
              Fills the schedule by the Rules. It only creates drafts: nothing
              is published and nobody is notified.
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-white/75">
                How to fill
              </span>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                <Pill
                  active={fill === "rules"}
                  onClick={() => setFill("rules")}
                >
                  By the rules
                </Pill>
                <Pill active={fill === "base"} onClick={() => setFill("base")}>
                  Copy a base week, then fix by the rules
                </Pill>
              </div>
            </div>
            {fill === "base" ? (
              <div className="flex flex-col gap-2" data-autofill-base>
                <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-white/85">
                  Base week
                  <select
                    data-base-week
                    value={baseWeek}
                    onChange={(e) => setBaseWeek(e.target.value)}
                    className={SELECT}
                  >
                    {Array.from({ length: 7 }, (_, i) =>
                      shiftYmd(thisWeek, (i - 6) * 7),
                    )
                      .reverse()
                      .map((ws) => (
                        <option key={ws} value={ws}>
                          {rangeText(ws, 1)}
                          {ws === thisWeek
                            ? " (this week)"
                            : ws === shiftYmd(thisWeek, -7)
                              ? " (last week)"
                              : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label
                  className={cn(
                    "flex flex-wrap items-center gap-2 text-[12.5px] text-white/85",
                    period && "hidden",
                  )}
                >
                  Fill
                  <select
                    data-base-count
                    value={baseCount}
                    onChange={(e) => setBaseCount(Number(e.target.value))}
                    className={SELECT}
                  >
                    {Array.from(
                      { length: BASE_MAX_WEEKS },
                      (_, i) => i + 1,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n} week{n === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                  starting
                  <select
                    data-base-start
                    value={baseStart}
                    onChange={(e) => setBaseStart(e.target.value)}
                    className={SELECT}
                  >
                    {[0, 1, 2].map((k) => {
                      const ws = shiftYmd(thisWeek, k * 7);
                      return (
                        <option key={ws} value={ws}>
                          {rangeText(ws, 1)}
                          {k === 0
                            ? " (this week)"
                            : k === 1
                              ? " (next week)"
                              : ""}
                        </option>
                      );
                    })}
                  </select>
                  <span className="text-white/70">
                    · {rangeText(baseStart, baseCount)}
                  </span>
                </label>
                <p className="text-[12px] text-white/70">
                  Each person gets the same shifts as in the base week. Shifts
                  that break a Rule are changed, and weekend shifts follow the
                  Weekend rotation. Weeks that already have shifts keep them and
                  only the empty days are filled.
                </p>
              </div>
            ) : null}
            {period ? (
              <RulePicker
                rules={rules}
                ctx={period.ctx}
                skipped={skipped}
                onToggle={(i) =>
                  setSkipped((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
              />
            ) : null}
            <div
              className={cn(
                "flex flex-col gap-1.5",
                (fill === "base" || period) && "hidden",
              )}
            >
              <span className="text-[12px] font-medium text-white/75">
                Which weeks
              </span>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                <Pill
                  active={weeksCount === 1}
                  onClick={() => setWeeksCount(1)}
                >
                  This week · {rangeText(weekStart, 1)}
                </Pill>
                <Pill
                  active={weeksCount === 4}
                  onClick={() => setWeeksCount(4)}
                >
                  Next 4 weeks · {rangeText(weekStart, 4)}
                </Pill>
              </div>
            </div>
            <p className="text-[12px] text-white/70">
              Published weeks are skipped. They can only be changed by hand.
            </p>
            <Footer>
              <button
                type="button"
                onClick={onClose}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void inspect()}
                className={DARK_PRIMARY_BUTTON_CLASS}
              >
                Preview
              </button>
            </Footer>
          </>
        ) : null}

        {step.kind === "loading" ? (
          <p className="text-[13px] text-white/80">{step.text}</p>
        ) : null}

        {step.kind === "leave" ? (
          <LeaveStep
            weeks={step.weeks}
            employees={active}
            newLeave={newLeave}
            onToggle={(id, date) =>
              setNewLeave((cur) => {
                const have = cur[id] ?? [];
                const next = have.includes(date)
                  ? have.filter((x) => x !== date)
                  : [...have, date];
                return { ...cur, [id]: next };
              })
            }
            onBack={() => setStep({ kind: "setup" })}
            onContinue={() => afterLeave(step)}
          />
        ) : null}

        {step.kind === "decide" ? (
          <>
            <div
              className="rounded-[8px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-3 py-2.5 text-[13px] text-[#fde68a]"
              data-autofill-existing
            >
              {step.weeks
                .filter((w) => !w.published && w.existingSlots > 0)
                .map(
                  (w) =>
                    `${rangeText(w.weekStart, 1)} already has ${w.existingSlots} shifts`,
                )
                .join(". ")}
              . What should Auto-fill do with them?
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
                <Pill
                  active={mode === "replace"}
                  onClick={() => setMode("replace")}
                >
                  Replace them
                </Pill>
                <Pill
                  active={mode === "append"}
                  onClick={() => setMode("append")}
                >
                  Add to them
                </Pill>
              </div>
              <p className="mt-2 text-[12px] text-[#fde68a]/90">
                Replace deletes the existing shifts of these weeks first. Add to
                them keeps the assigned shifts and only fills in around them.
              </p>
            </div>
            <Footer>
              <button
                type="button"
                onClick={onClose}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => runEngine(step.weeks, step.history, mode, 1)}
                className={DARK_PRIMARY_BUTTON_CLASS}
              >
                Preview
              </button>
            </Footer>
          </>
        ) : null}

        {step.kind === "preview" ? (
          <PreviewBody
            step={step}
            employees={active}
            settings={settings}
            hoursRules={rules}
            baseWeek={fill === "base" ? baseWeek : null}
            onAnother={() => {
              // 重排：同样的输入、换一个 seed；需要重读现状时回到 inspect 太慢，这里直接用上一次读到的
              void reroll(step);
            }}
            onCreate={() => void create(step.proposals)}
            onClose={onClose}
          />
        ) : null}

        {step.kind === "creating" ? (
          <p className="text-[13px] text-white/80">Creating the drafts…</p>
        ) : null}

        {step.kind === "error" ? (
          <>
            <p role="alert" className="text-[13px] text-red-300">
              {step.message}
            </p>
            <Footer>
              <button
                type="button"
                onClick={onClose}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Close
              </button>
            </Footer>
          </>
        ) : null}
      </div>
    </div>
  );

  async function reroll(from: Extract<Step, { kind: "preview" }>) {
    // 重读一遍现状再用新的 seed 排（现状可能被别人改过）
    try {
      setStep({ kind: "loading", text: "Trying another arrangement…" });
      const history: WeekPlan[] = [];
      for (let i = HISTORY_WEEKS; i >= 1; i--) {
        const w = await fetchScheduleWeek(shiftYmd(firstWeek, -i * 7));
        history.push(planOf(w, active));
      }
      const weeks: WeekInfo[] = [];
      for (const ws of targets) {
        const w = await fetchScheduleWeek(ws);
        weeks.push({
          weekStart: ws,
          published: w.status === "published",
          existingSlots: w.slots.length,
          copied: !!w.copied_from,
          plan: planOf(w, active),
          timeOff: w.time_off ?? [],
        });
      }
      if (fill === "base") {
        const base = planOf(await fetchScheduleWeek(baseWeek), active);
        runBase(weeks, history, base, from.seed + 1);
      } else runEngine(weeks, history, mode, from.seed + 1);
    } catch (error) {
      setStep({ kind: "error", message: describeError(error) });
    }
  }
}

/**
 * Period 的规则清单：Rules 标签上开着的每条一个勾，默认全勾；取消的这一次不执行。
 * Shift times（上下班时间）排班一定要用：勾着、灰掉（preview ①b）。
 */
function RulePicker({
  rules,
  ctx,
  skipped,
  onToggle,
}: {
  rules: Rule[];
  ctx: DescribeContext;
  skipped: ReadonlySet<number>;
  onToggle: (index: number) => void;
}) {
  const optional = rules.filter((r) => r.type !== "shift_times").length;
  const ticked = rules.filter(
    (r, i) => r.type !== "shift_times" && !skipped.has(i),
  ).length;
  return (
    <div className="flex flex-col gap-1.5" data-autofill-rules>
      <span className="text-[12px] font-medium text-white/75">
        Rules to use this time
      </span>
      <p className="text-[12px] text-white/70">
        Unticked rules are skipped for this fill only. The Rules tab does not
        change.
      </p>
      <div className="flex flex-col gap-1">
        {rules.map((r, i) => {
          const always = r.type === "shift_times";
          return (
            <label
              key={r.id ?? i}
              data-autofill-rule={r.type}
              className={cn(
                "flex items-start gap-2 text-[13px]",
                always ? "text-white/50" : "text-white/90",
              )}
            >
              <input
                type="checkbox"
                checked={always || !skipped.has(i)}
                disabled={always}
                onChange={() => onToggle(i)}
                className="mt-[3px] size-[14px] shrink-0 accent-[#3b82f6]"
              />
              <span>
                {describeRule(r, ctx)}
                {always ? " — always used" : ""}
              </span>
            </label>
          );
        })}
        <label className="flex items-start gap-2 text-[13px] text-white/50">
          <input
            type="checkbox"
            checked
            disabled
            className="mt-[3px] size-[14px] shrink-0"
          />
          <span>Shift times from Settings — always used</span>
        </label>
      </div>
      <p data-autofill-rules-count className="text-[12px] text-white/60">
        {ticked} of {optional} rule{optional === 1 ? "" : "s"} ticked.
      </p>
    </div>
  );
}

function rangeText(weekStart: string, weeks: number): string {
  const fmt = (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(weekStart)} – ${fmt(shiftYmd(weekStart, weeks * 7 - 1))}`;
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12.5px] font-bold",
        active
          ? "border-sky-400/60 bg-sky-400/20 text-sky-200"
          : "border-white/20 text-white hover:border-white/40",
      )}
    >
      {children}
    </button>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2">{children}</div>;
}

function PreviewBody({
  step,
  employees,
  settings,
  hoursRules,
  baseWeek,
  onAnother,
  onCreate,
  onClose,
}: {
  step: Extract<Step, { kind: "preview" }>;
  employees: ScheduleEmployee[];
  settings: ScheduleSettings;
  /** 看「每周超几小时提醒」用的规则（置顶 110 题 3 / 4）。 */
  hoursRules: Rule[];
  /** 按基础周排时是哪一周；照 Rules 排 = null。 */
  baseWeek: string | null;
  onAnother: () => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const total = step.proposals.reduce((n, p) => n + p.create.length, 0);
  const problems = step.proposals.flatMap((p) => p.problems);
  const label = (key: string) =>
    settings.shift_types.find((t) => t.key === key)?.label ?? key;
  // 置顶 110 题 3 A：超过每周提醒小时数的人，黄框下面单独一行琥珀字（只提醒，不算排不下）。
  const limit = weeklyHoursLimit(hoursRules);
  const live = step.proposals.filter((p) => !p.skipped);
  const over = live.flatMap((p) =>
    overHours(hoursRules, p.plan, employees).map((o) => ({
      ...o,
      week: p.weekStart,
    })),
  );
  return (
    <>
      {baseWeek ? (
        <p data-autofill-base-note className="text-[13px] text-white/80">
          Copied from the base week {rangeText(baseWeek, 1)}. Days with an{" "}
          <span className="rounded-[4px] px-1 outline-2 outline-[#f59e0b]">
            amber frame
          </span>{" "}
          were changed to follow the Rules (point at one to see why).
        </p>
      ) : null}
      {problems.length === 0 ? (
        <p
          data-autofill-ok
          className="rounded-[8px] border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-[13px] text-emerald-300"
        >
          All rules are met. Nothing is saved yet.
        </p>
      ) : (
        <div
          data-autofill-problems
          className="rounded-[8px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-3 py-2.5 text-[13px] text-[#fde68a]"
        >
          {problems.length} thing{problems.length === 1 ? "" : "s"} could not be
          placed without breaking a rule:
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px]">
            Cannot work comes before Coverage. Anything that can&apos;t be
            placed stays empty, so you can fill it by hand.
          </p>
        </div>
      )}
      {limit != null && over.length ? (
        <p
          data-autofill-over-hours
          className="text-[13px] font-semibold text-[#fcd34d]"
        >
          Over {limit} hours:{" "}
          {over
            .map(
              (o) =>
                `${o.name} ${o.hours} h ${live.length > 1 ? `(${rangeText(o.week, 1)})` : "this week"}`,
            )
            .join(", ")}
          .
        </p>
      ) : null}
      {step.proposals.map((p) => (
        <div
          key={p.weekStart}
          className="flex flex-col gap-1.5"
          data-autofill-week={p.weekStart}
        >
          <h3 className="text-[13.5px] font-semibold text-white">
            {rangeText(p.weekStart, 1)}
            {p.skipped ? (
              <span className="ml-2 text-[12px] font-normal text-white/70">
                published — skipped
              </span>
            ) : baseWeek ? (
              <span
                data-base-mode={p.replace ? "replace" : "fill"}
                className="ml-2 text-[12px] font-normal text-white/70"
              >
                {p.replace
                  ? "replaces the shifts copied from the week before"
                  : "keeps the shifts already there, fills the empty days"}
              </span>
            ) : null}
          </h3>
          {p.skipped ? null : (
            <PlanTable
              plan={p.plan}
              employees={employees}
              label={label}
              changed={p.changed}
              leaveCells={p.leaveCells}
            />
          )}
          {!p.skipped && baseWeek && p.problems.length ? (
            <ul className="list-disc pl-5 text-[12px] text-red-300">
              {p.problems.map((x, i) => (
                <li key={i}>{x.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <Footer>
        <button
          type="button"
          onClick={onClose}
          className={DARK_SECONDARY_BUTTON_CLASS}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAnother}
          className={DARK_SECONDARY_BUTTON_CLASS}
        >
          Try another arrangement
        </button>
        <button
          type="button"
          disabled={total === 0 && step.proposals.every((p) => p.skipped)}
          onClick={onCreate}
          className={DARK_PRIMARY_BUTTON_CLASS}
        >
          {baseWeek
            ? `Create drafts for ${step.proposals.filter((p) => !p.skipped).length} week${step.proposals.filter((p) => !p.skipped).length === 1 ? "" : "s"}`
            : "Create draft"}
        </button>
      </Footer>
    </>
  );
}

function PlanTable({
  plan,
  employees,
  label,
  changed,
  leaveCells,
}: {
  plan: WeekPlan;
  employees: ScheduleEmployee[];
  label: (key: string) => string;
  /** 按基础周排：跟基础周不一样的格子（`<员工 id>|<星期几>` → 原因），琥珀框。 */
  changed?: Record<string, string>;
  /** 置顶 117：Leave 的格子（`<员工 id>|<星期几>` → PTO / Sick / Personal / Leave）。 */
  leaveCells?: Record<string, string>;
}) {
  const dates = DAY_LABELS.map((_, i) => shiftYmd(plan.weekStart, i));
  return (
    <div className="overflow-x-auto">
      <div className="grid w-max grid-cols-[104px_repeat(7,122px)] gap-[2px]">
        <div className="pb-1 pl-[22px] text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
          Staff
        </div>
        {dates.map((d, i) => (
          <div key={d} className="pb-1 text-center text-white/90">
            <div className="text-[11px] font-bold tracking-[.06em] uppercase">
              {DAY_LABELS[i]}
            </div>
            <div className="font-mono text-[10px] text-white/80">
              {d.slice(5).replace("-", "/")}
            </div>
          </div>
        ))}
        {employees.map((e) => (
          <PlanRow
            key={e.id}
            employee={e}
            days={plan.byEmployee[e.id] ?? []}
            label={label}
            changed={changed}
            leaveCells={leaveCells}
          />
        ))}
      </div>
    </div>
  );
}

function PlanRow({
  employee,
  days,
  label,
  changed,
  leaveCells,
}: {
  employee: ScheduleEmployee;
  days: DayShift[];
  label: (key: string) => string;
  changed?: Record<string, string>;
  leaveCells?: Record<string, string>;
}) {
  return (
    <>
      <div className="flex min-h-[56px] items-center gap-[7px] rounded-[6px] bg-[#0b1727] px-2 text-[15px] leading-tight font-bold text-white">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: personDotColor(employee.id) }}
        />
        <span className="min-w-0 break-words">{employee.name}</span>
      </div>
      {Array.from({ length: 7 }, (_, d) => {
        const s = days[d];
        const why = changed?.[`${employee.id}|${d}`];
        return (
          <div
            key={d}
            data-changed={why || undefined}
            title={why ? `Changed from the base week: ${why}` : undefined}
            className={cn(
              "flex min-h-[56px] flex-col",
              why &&
                "rounded-[6px] outline-2 -outline-offset-1 outline-[#f59e0b]",
            )}
          >
            {s ? (
              <div
                className={cn(
                  "flex flex-1 flex-col justify-center gap-0.5 rounded-[6px] border px-2 py-1 text-[11px] leading-tight",
                  shiftCardClass(s.type),
                )}
              >
                <b className="text-[12.5px]">{label(s.type)}</b>
                <span className="font-mono text-[10px] font-semibold tracking-[-.2px] whitespace-nowrap text-white">
                  {formatClock(s.start)} – {formatClock(s.end)}
                </span>
              </div>
            ) : leaveCells?.[`${employee.id}|${d}`] ? (
              <LeaveCard label={leaveCells[`${employee.id}|${d}`]} />
            ) : (
              <OffCard />
            )}
          </div>
        );
      })}
    </>
  );
}

/** 置顶 117：Leave 那一格，同排班页休假卡的黄色（跟灰色的每周 Off 分开）。 */
function LeaveCard({ label }: { label: string }) {
  return (
    <div
      data-autofill-leave={label}
      className="flex flex-1 flex-col justify-center gap-0.5 rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] px-2 py-1 text-[#fde68a]"
    >
      <b className="text-[12.5px] leading-tight">{label}</b>
    </div>
  );
}

/**
 * 置顶 117：Auto-fill 排之前的 Leave 一步。每人一行、要排的每一天一格：已存的休假照种类显示（不能在这里改，到排班页那格改）；
 * 点空格标 Leave（再点取消）。只暂存，排班结果按 Create draft 时才存。
 */
function LeaveStep({
  weeks,
  employees,
  newLeave,
  onToggle,
  onBack,
  onContinue,
}: {
  weeks: WeekInfo[];
  employees: ScheduleEmployee[];
  newLeave: Record<number, string[]>;
  onToggle: (employeeId: number, date: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const live = weeks.filter((w) => !w.published);
  const dates = live.flatMap((w) =>
    DAY_LABELS.map((_, i) => shiftYmd(w.weekStart, i)),
  );
  const saved = new Map(
    live.flatMap((w) =>
      w.timeOff.map((t) => [`${t.employee_id}|${t.date}`, t] as const),
    ),
  );
  const picked = Object.values(newLeave).reduce((n, d) => n + d.length, 0);
  return (
    <>
      <p className="text-[13px] text-white/80">
        Click the days each person has approved leave. Leave is on top of the
        weekly days off: Auto-fill gives no shift on these days and still gives
        the usual days off. Leave already on the schedule is shown and kept.
      </p>
      {live.length === 0 ? (
        <p className="text-[13px] text-white/80">
          All these weeks are published. Nothing will be filled.
        </p>
      ) : (
        <div className="overflow-x-auto" data-autofill-leave-grid>
          <div
            className="grid w-max gap-[2px]"
            style={{
              gridTemplateColumns: `104px repeat(${dates.length}, 58px)`,
            }}
          >
            <div className="sticky left-0 z-10 bg-[#0d1b2e] pb-1 pl-[22px] text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
              Staff
            </div>
            {dates.map((d, i) => (
              <div key={d} className="pb-1 text-center text-white/90">
                <div className="text-[10.5px] font-bold tracking-[.05em] uppercase">
                  {DAY_LABELS[i % 7]}
                </div>
                <div className="font-mono text-[10px] text-white/80">
                  {d.slice(5).replace("-", "/")}
                </div>
              </div>
            ))}
            {employees.map((e) => (
              <LeaveRow
                key={e.id}
                employee={e}
                dates={dates}
                saved={saved}
                picked={newLeave[e.id] ?? []}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}
      <p className="text-[12px] text-white/70" data-autofill-leave-count>
        {picked
          ? `${picked} new leave day${picked === 1 ? "" : "s"}. They are saved when you create the draft.`
          : "No new leave picked."}
      </p>
      <Footer>
        <button
          type="button"
          onClick={onBack}
          className={DARK_SECONDARY_BUTTON_CLASS}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          className={DARK_PRIMARY_BUTTON_CLASS}
        >
          Continue
        </button>
      </Footer>
    </>
  );
}

function LeaveRow({
  employee,
  dates,
  saved,
  picked,
  onToggle,
}: {
  employee: ScheduleEmployee;
  dates: string[];
  saved: Map<string, ScheduleTimeOff>;
  picked: string[];
  onToggle: (employeeId: number, date: string) => void;
}) {
  return (
    <>
      {/* 名字一列横向滚动时固定在左边（4 周 28 天要左右滑）。 */}
      <div className="sticky left-0 z-10 flex min-h-[40px] items-center gap-[7px] rounded-[6px] bg-[#0b1727] px-2 text-[14px] leading-tight font-bold text-white">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: personDotColor(employee.id) }}
        />
        <span className="min-w-0 break-words">{employee.name}</span>
      </div>
      {dates.map((date) => {
        const t = saved.get(`${employee.id}|${date}`);
        if (t)
          return (
            <div
              key={date}
              data-leave-saved={`${employee.id}|${date}`}
              title="Already on the schedule"
              className="flex min-h-[40px] items-center justify-center rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] text-[11.5px] font-bold text-[#fde68a]"
            >
              {TIME_OFF_LABEL[t.kind] ?? "Leave"}
            </div>
          );
        const on = picked.includes(date);
        return (
          <button
            key={date}
            type="button"
            data-leave-cell={`${employee.id}|${date}`}
            aria-pressed={on}
            onClick={() => onToggle(employee.id, date)}
            className={cn(
              "flex min-h-[40px] cursor-pointer items-center justify-center rounded-[6px] border text-[11.5px] font-bold",
              on
                ? "border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] text-[#fde68a]"
                : "border-white/10 bg-white/[.03] text-white/35 hover:bg-white/[.07]",
            )}
          >
            {on ? "Leave" : "—"}
          </button>
        );
      })}
    </>
  );
}
