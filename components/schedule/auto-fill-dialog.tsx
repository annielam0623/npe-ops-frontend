"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";
import { shiftYmd } from "@/lib/la-date";
import { fetchScheduleWeek } from "@/lib/schedule-api";
import { bulkCreateSlots } from "@/lib/schedule-rules-api";
import {
  generateWeek,
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

interface WeekInfo {
  weekStart: string;
  published: boolean;
  existingSlots: number;
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
}: AutoFillDialogProps) {
  const titleId = useId();
  const pressedOnBackdropRef = useRef(false);
  const [weeksCount, setWeeksCount] = useState<1 | 4>(1);
  const [mode, setMode] = useState<Mode>("replace");
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

  const targets = Array.from({ length: weeksCount }, (_, i) =>
    shiftYmd(weekStart, i * 7),
  );

  /** 读各周现状（后端说：生成前必须先 GET；顺序读）。 */
  async function inspect() {
    try {
      setStep({ kind: "loading", text: "Checking the weeks…" });
      const history: WeekPlan[] = [];
      for (let i = HISTORY_WEEKS; i >= 1; i--) {
        const w = await fetchScheduleWeek(shiftYmd(weekStart, -i * 7));
        history.push(planOf(w, active));
      }
      const weeks: WeekInfo[] = [];
      for (const ws of targets) {
        const w = await fetchScheduleWeek(ws);
        weeks.push({
          weekStart: ws,
          published: w.status === "published",
          existingSlots: w.slots.length,
          plan: planOf(w, active),
        });
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
        // 班次默认时间（后端正式来源）排在最后，盖过旧的 shift_times 规则。
        rules: [
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
        ],
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

  async function create(proposals: Proposal[]) {
    setStep({ kind: "creating" });
    let made = 0;
    let weeksMade = 0;
    try {
      for (const p of proposals) {
        if (p.skipped) continue;
        await bulkCreateSlots(p.weekStart, {
          replace: mode === "replace",
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
    onDone(
      `Created ${made} draft shift${made === 1 ? "" : "s"} for ${weeksMade} week${weeksMade === 1 ? "" : "s"}${skipped ? ` (${skipped} published week${skipped === 1 ? "" : "s"} skipped)` : ""}. Nothing is published and nobody was notified.`,
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
            ? `Preview · ${rangeText(weekStart, weeksCount)}`
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
        const w = await fetchScheduleWeek(shiftYmd(weekStart, -i * 7));
        history.push(planOf(w, active));
      }
      const weeks: WeekInfo[] = [];
      for (const ws of targets) {
        const w = await fetchScheduleWeek(ws);
        weeks.push({
          weekStart: ws,
          published: w.status === "published",
          existingSlots: w.slots.length,
          plan: planOf(w, active),
        });
      }
      runEngine(weeks, history, mode, from.seed + 1);
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
  onAnother,
  onCreate,
  onClose,
}: {
  step: Extract<Step, { kind: "preview" }>;
  employees: ScheduleEmployee[];
  settings: ScheduleSettings;
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
            ) : null}
          </h3>
          {p.skipped ? null : (
            <PlanTable plan={p.plan} employees={employees} label={label} />
          )}
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
          Create draft
        </button>
      </Footer>
    </>
  );
}

function PlanTable({
  plan,
  employees,
  label,
}: {
  plan: WeekPlan;
  employees: ScheduleEmployee[];
  label: (key: string) => string;
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
}: {
  employee: ScheduleEmployee;
  days: DayShift[];
  label: (key: string) => string;
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
        return (
          <div key={d} className="flex min-h-[56px] flex-col">
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
