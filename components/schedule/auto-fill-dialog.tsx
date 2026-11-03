"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";
import { laToday, shiftYmd, weekStartYmd } from "@/lib/la-date";
import { fetchScheduleWeek } from "@/lib/schedule-api";
import { bulkCreateSlots } from "@/lib/schedule-rules-api";
import {
  generateWeek,
  seedFromBase,
  type DayShift,
  type Problem,
  type Rule,
  type WeekPlan,
} from "@/lib/schedule-engine";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type { ScheduleEmployee, ScheduleSettings, ScheduleWeek } from "@/types";

import { DAY_LABELS, personDotColor, shiftCardClass } from "./config";
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
}

type Step =
  | { kind: "setup" }
  | { kind: "loading"; text: string }
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
  onDraftThisWeek?: (made: Proposal["create"], replace: boolean) => void;
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
}: AutoFillDialogProps) {
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
  const busy = step.kind === "loading" || step.kind === "creating";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const firstWeek = fill === "base" ? baseStart : weekStart;
  const targetCount = fill === "base" ? baseCount : weeksCount;
  const targets = Array.from({ length: targetCount }, (_, i) =>
    shiftYmd(firstWeek, i * 7),
  );
  // 班次默认时间（后端正式来源）排在最后，盖过旧的 shift_times 规则。
  const allRules: Rule[] = [
    ...rules,
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
        });
      }
      if (fill === "base") {
        // 按基础周排：已有草稿的周只填空格（题 ③ A），不问 Replace / Add。
        const base = planOf(await fetchScheduleWeek(baseWeek), active);
        runBase(weeks, history, base, 1);
        return;
      }
      const hasExisting = weeks.some(
        (w) => !w.published && w.existingSlots > 0,
      );
      if (hasExisting) setStep({ kind: "decide", weeks, history });
      else runEngine(weeks, history, "replace", 1);
    } catch (error) {
      setStep({ kind: "error", message: describeError(error) });
    }
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
    // 当前这一周：放到页面上等整周 Save（B9 Q6），不直接建。
    let onPage = 0;
    try {
      for (const p of proposals) {
        if (p.skipped) continue;
        const replace = p.replace ?? mode === "replace";
        if (onDraftThisWeek && p.weekStart === weekStart) {
          onDraftThisWeek(p.create, replace);
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
      }
    } catch (error) {
      setStep({
        kind: "error",
        message: `${describeError(error)}${weeksMade ? ` (${weeksMade} week(s) were already created as drafts before this.)` : " Nothing was created."}`,
      });
      return;
    }
    const skipped = proposals.filter((p) => p.skipped).length;
    const skippedText = skipped
      ? ` (${skipped} published week${skipped === 1 ? "" : "s"} skipped)`
      : "";
    const pageText = `Put ${onPage} shift${onPage === 1 ? "" : "s"} on this week. Click Save to keep them.`;
    onDone(
      weeksMade
        ? `${onPage ? `${pageText} ` : ""}Created ${made} draft shift${made === 1 ? "" : "s"} for ${weeksMade}${onPage ? " other" : ""} week${weeksMade === 1 ? "" : "s"}${skippedText}. Nothing is published and nobody was notified.`
        : `${pageText}${skippedText ? ` ${skippedText.trim()}.` : ""} Nothing is published and nobody was notified.`,
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
                <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-white/85">
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
            <div
              className={cn(
                "flex flex-col gap-1.5",
                fill === "base" && "hidden",
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
  baseWeek,
  onAnother,
  onCreate,
  onClose,
}: {
  step: Extract<Step, { kind: "preview" }>;
  employees: ScheduleEmployee[];
  settings: ScheduleSettings;
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
}: {
  plan: WeekPlan;
  employees: ScheduleEmployee[];
  label: (key: string) => string;
  /** 按基础周排：跟基础周不一样的格子（`<员工 id>|<星期几>` → 原因），琥珀框。 */
  changed?: Record<string, string>;
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
}: {
  employee: ScheduleEmployee;
  days: DayShift[];
  label: (key: string) => string;
  changed?: Record<string, string>;
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
            ) : (
              <OffCard />
            )}
          </div>
        );
      })}
    </>
  );
}
