"use client";

import { Fragment, useEffect, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { laToday, shiftYmd, weekStartYmd } from "@/lib/la-date";
import { fetchScheduleWeek } from "@/lib/schedule-api";
import {
  type ConfirmationPerson,
  fetchWeekConfirmations,
} from "@/lib/schedule-confirm-api";
import { SHIFT_SWATCH, shiftColorOf } from "@/lib/schedule-shift-colors";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type { ScheduleEmployee, ScheduleWeek } from "@/types";

import { CARD, CARD_HEADER, DAY_LABELS, MUTED, TIME_OFF_LABEL } from "./config";

/** Period 最多看几周（preview 题：1–8 周）。 */
export const PERIOD_MAX_WEEKS = 8;

type Load =
  | { kind: "loading" }
  | {
      kind: "ready";
      weeks: ScheduleWeek[];
      /** 每人这一段的确认情况（只算已发布的周）；读不到 = null，不出这一列。 */
      confirmed: Map<number, PersonConfirm> | null;
    }
  | { kind: "error"; message: string };

/** 绿 = 每周都确认了；黄 = 有一周提了改动；红 = 还有没确认的周（Annie 规矩：没处理红点、处理了绿点）。 */
type PersonConfirm = "confirmed" | "changes" | "not_yet";

const CONFIRM_TEXT: Record<PersonConfirm, string> = {
  confirmed: "Confirmed",
  changes: "Asked for a change",
  not_yet: "Not confirmed",
};
const CONFIRM_DOT: Record<PersonConfirm, string> = {
  confirmed: "bg-[#4ade80]",
  changes: "bg-[#fbbf24]",
  not_yet: "bg-[#f87171]",
};

/** 各周的回应合起来：有一周想改 ⇒ 黄；全部 accepted / counted_accepted ⇒ 绿；其余红。 */
function combine(answers: ConfirmationPerson["answer"][]): PersonConfirm {
  if (answers.includes("wants_changes")) return "changes";
  return answers.every((a) => a === "accepted" || a === "counted_accepted")
    ? "confirmed"
    : "not_yet";
}

/**
 * Staff Schedule › Period（Annie 2026-11-08「动手吧」，preview https://claude.ai/artifact/HnBVL6wANcCZYs1r1enq3W，题全 A）：
 * 自己定开始的那一周和周数，把这几周已经排好的周表连起来看（只看不改，点周名回 Schedule 标签改那一周）；
 * 「Auto-fill these weeks」按这次勾选的 Rules 排这几周（AutoFillDialog 的 period 模式）。
 * 「Share with staff」（schedule.publish）：SharePeriodDialog，后端 33 的 /api/schedule/period/share；最右「Confirmed?」逐周读确认情况合起来。
 * 可见性开关 schedule_period（默认只 Super Admin，可另外按人放开：Page visibility 的 Also allowed）。
 */
export function PeriodView({
  employees,
  canEdit,
  start,
  weeks,
  onChangeRange,
  reloadKey,
  onOpenWeek,
  onAutoFill,
  onShare,
  autoFillBlocked,
  onUnauthorized,
}: {
  /** 排班页的人（已按排班页顺序、只含在职的）。 */
  employees: ScheduleEmployee[];
  canEdit: boolean;
  /** 开始那一周的周日。 */
  start: string;
  weeks: number;
  onChangeRange: (start: string, weeks: number) => void;
  /** 变了就重读（Auto-fill 建好草稿之后）。 */
  reloadKey: number;
  onOpenWeek: (weekStart: string) => void;
  onAutoFill?: () => void;
  /** Share with staff（要 schedule.publish）；没传 = 不出这个键。 */
  onShare?: () => void;
  /** Auto-fill 不能点的原因（例如 Schedule 标签上有没存的改动）；null = 能点。 */
  autoFillBlocked: string | null;
  onUnauthorized: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoad({ kind: "loading" });
      try {
        // 按周顺序读（后端第一次打开某一周会照上一周复制，顺序读才会一周接一周）。
        const list: ScheduleWeek[] = [];
        for (let i = 0; i < weeks; i++) {
          list.push(
            await fetchScheduleWeek(shiftYmd(start, i * 7), controller.signal),
          );
        }
        // 确认情况：已发布的周逐周读 /weeks/{week}/confirmations（后端 33：不另开整段接口）；读不到就不出这一列。
        let confirmed: Map<number, PersonConfirm> | null = null;
        if (canEdit) {
          try {
            const answers = new Map<number, ConfirmationPerson["answer"][]>();
            const published = list.filter((w) => w.status === "published");
            for (const w of published) {
              const c = await fetchWeekConfirmations(
                w.week_start,
                controller.signal,
              );
              for (const p of c.people) {
                answers.set(p.employee_id, [
                  ...(answers.get(p.employee_id) ?? []),
                  p.answer,
                ]);
              }
            }
            if (published.length > 0) {
              confirmed = new Map(
                [...answers].map(([id, a]) => [id, combine(a)]),
              );
            }
          } catch (error) {
            if (isStatus(error, 401)) throw error;
            confirmed = null;
          }
        }
        if (!controller.signal.aborted)
          setLoad({ kind: "ready", weeks: list, confirmed });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setLoad({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [start, weeks, reloadKey, retry, canEdit, onUnauthorized]);

  const thisWeek = weekStartYmd(laToday());

  return (
    <section data-period className={CARD}>
      <div className={CARD_HEADER}>
        <h2 className="text-[14px] font-semibold text-white" data-period-title>
          {rangeLabel(start, weeks)} · {weeks} week{weeks === 1 ? "" : "s"}
        </h2>
        <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-white/70">
          <label className="flex items-center gap-1.5">
            Start
            <input
              type="date"
              data-period-start
              value={start}
              onChange={(event) => {
                const v = event.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(v))
                  onChangeRange(weekStartYmd(v), weeks);
              }}
              className="rounded-md border border-white/15 bg-white/[.05] px-2 py-1 text-[12.5px] text-white [color-scheme:dark]"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Weeks
            <select
              data-period-weeks
              value={weeks}
              onChange={(event) =>
                onChangeRange(start, Number(event.target.value))
              }
              className="rounded-md border border-white/15 bg-white/[.05] px-2 py-1 text-[12.5px] text-white [color-scheme:dark]"
            >
              {Array.from({ length: PERIOD_MAX_WEEKS }, (_, i) => i + 1).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
          </label>
          {onAutoFill ? (
            <button
              type="button"
              data-period-autofill
              disabled={autoFillBlocked !== null}
              title={autoFillBlocked ?? undefined}
              onClick={onAutoFill}
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              Auto-fill these weeks
            </button>
          ) : null}
          {onShare ? (
            <button
              type="button"
              data-period-share
              onClick={onShare}
              className={DARK_PRIMARY_BUTTON_CLASS}
            >
              Share with staff
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 p-4">
        {autoFillBlocked && onAutoFill ? (
          <p data-period-blocked className="text-[12px] text-[#fcd34d]">
            {autoFillBlocked}
          </p>
        ) : null}
        <p className={cn(MUTED, "text-[12px] max-sm:hidden")}>
          Read only. Click a week&apos;s name to change it on the Schedule tab.
        </p>

        {load.kind === "loading" ? (
          <p className={cn(MUTED, "text-[13px]")}>Loading the weeks…</p>
        ) : load.kind === "error" ? (
          <div role="alert" className="text-[13px] text-red-300">
            {load.message}{" "}
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              className="underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <PeriodGrid
            weeks={load.weeks}
            employees={employees}
            thisWeek={thisWeek}
            onOpenWeek={onOpenWeek}
            confirmed={load.confirmed}
          />
        )}
      </div>

      <div className="px-4">
        <HowToUse
          dark
          title="How to use — Period"
          items={[
            "Pick the Start week and how many Weeks to see. Each person is one row, and the weeks run left to right.",
            "Each week shows Published or Draft. Click a week's name to open it on the Schedule tab, change it there, then Save and Publish.",
            ...(canEdit && onAutoFill
              ? [
                  "Auto-fill these weeks fills the drafts for these weeks. Untick any rule you don't want this time. Shift times are always used. Click Preview, check it, then create the drafts. Published weeks are skipped.",
                  "Unticking a rule here only affects this fill. The Rules tab does not change.",
                ]
              : []),
            ...(onShare
              ? [
                  "Publish every week first. Then click Share with staff: it lists who will get the email and who can't be reached. Click Send to email each person one link to their own shifts for these weeks.",
                  "Each person confirms all the weeks at once, or asks for a change on a day. Confirmed? shows each person: green = confirmed every week, yellow = asked for a change, red = not confirmed yet.",
                ]
              : []),
          ]}
        />
      </div>
    </section>
  );
}

function PeriodGrid({
  weeks,
  employees,
  thisWeek,
  onOpenWeek,
  confirmed,
}: {
  weeks: ScheduleWeek[];
  employees: ScheduleEmployee[];
  thisWeek: string;
  onOpenWeek: (weekStart: string) => void;
  confirmed: Map<number, PersonConfirm> | null;
}) {
  const dates = weeks.flatMap((w) =>
    Array.from({ length: 7 }, (_, d) => shiftYmd(w.week_start, d)),
  );
  const openByDate = new Map<string, number>();
  for (const w of weeks)
    for (const s of w.slots)
      if (s.employee_id == null)
        openByDate.set(s.date, (openByDate.get(s.date) ?? 0) + 1);
  const cellOf = (employeeId: number, date: string, week: ScheduleWeek) => {
    const slots = week.slots
      .filter((s) => s.employee_id === employeeId && s.date === date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (slots.length)
      return slots.map((s) => (
        <span
          key={s.id}
          data-period-shift={s.shift_type}
          className="block rounded-[5px] px-1 text-[11px] text-white tabular-nums"
          style={{ background: SHIFT_SWATCH[shiftColorOf(s.shift_type)] }}
        >
          {short(s.start_time)}–{short(s.end_time)}
        </span>
      ));
    const off = week.time_off?.find(
      (t) => t.employee_id === employeeId && t.date === date,
    );
    if (off)
      return (
        <span
          data-period-off
          className="block rounded-[5px] bg-[#fbbf24]/20 px-1 text-[11px] text-[#fcd34d]"
        >
          {TIME_OFF_LABEL[off.kind] ?? "Off"}
        </span>
      );
    return <span className="text-white/25">–</span>;
  };
  const sep = (d: number) => (d === 6 ? "border-r-2 border-r-white/20" : "");

  return (
    <div className="overflow-x-auto rounded-[10px] border border-white/10">
      <table data-period-grid className="border-collapse text-[11.5px]">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 z-[1] min-w-[120px] border-r border-b border-white/10 bg-[#0b1622] px-2 text-left text-[12px] font-semibold"
            >
              Staff
            </th>
            {weeks.map((w) => (
              <th
                key={w.week_start}
                colSpan={7}
                data-period-week={w.week_start}
                className="border-r-2 border-b border-white/20 border-b-white/10 bg-white/[.05] px-2 py-1.5 text-left font-semibold whitespace-nowrap"
              >
                <button
                  type="button"
                  onClick={() => onOpenWeek(w.week_start)}
                  className="cursor-pointer text-white underline-offset-2 hover:underline"
                >
                  Week of {dayLabel(w.week_start)}
                  {w.week_start === thisWeek ? " (this week)" : ""}
                </button>
                <span
                  data-period-status={w.status}
                  className={cn(
                    "ml-2 font-normal",
                    w.status === "published"
                      ? "text-white/60"
                      : "text-[#fcd34d]",
                  )}
                >
                  · {w.status === "published" ? "Published" : "Draft"}
                </span>
              </th>
            ))}
            {confirmed ? (
              <th
                rowSpan={2}
                className="border-b border-white/10 px-2 py-1 text-left font-semibold whitespace-nowrap text-white/55"
              >
                Confirmed?
              </th>
            ) : null}
          </tr>
          <tr>
            {weeks.map((w) =>
              Array.from({ length: 7 }, (_, d) => (
                <th
                  key={`${w.week_start}-${d}`}
                  className={cn(
                    "border-r border-b border-white/[.06] px-1 py-1 font-semibold whitespace-nowrap text-white/55",
                    sep(d),
                  )}
                >
                  {DAY_LABELS[d]} {Number(shiftYmd(w.week_start, d).slice(8))}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id} data-period-row={e.id}>
              <td className="sticky left-0 z-[1] border-r border-b border-white/10 bg-[#0b1622] px-2 py-1 text-[12.5px] font-semibold whitespace-nowrap">
                {e.name}
              </td>
              {weeks.map((w) =>
                Array.from({ length: 7 }, (_, d) => (
                  <td
                    key={`${w.week_start}-${d}`}
                    className={cn(
                      "border-r border-b border-white/[.06] px-1 py-1 text-center align-top whitespace-nowrap",
                      sep(d),
                    )}
                  >
                    {cellOf(e.id, shiftYmd(w.week_start, d), w)}
                  </td>
                )),
              )}
              {confirmed ? (
                <td
                  data-period-confirm={confirmed.get(e.id) ?? ""}
                  className="border-b border-white/[.06] px-2 py-1 text-[12px] whitespace-nowrap"
                >
                  {confirmed.has(e.id) ? (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          "mr-1.5 inline-block size-[7px] rounded-full align-[1px]",
                          CONFIRM_DOT[confirmed.get(e.id) as PersonConfirm],
                        )}
                      />
                      {CONFIRM_TEXT[confirmed.get(e.id) as PersonConfirm]}
                    </>
                  ) : (
                    <span className="text-white/30">–</span>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
          {openByDate.size > 0 ? (
            <tr data-period-open-row>
              <td className="sticky left-0 z-[1] border-r border-white/10 bg-[#0b1622] px-2 py-1 text-[12px] font-semibold whitespace-nowrap text-red-300">
                Not assigned
              </td>
              {dates.map((date, i) => (
                <Fragment key={date}>
                  <td
                    className={cn(
                      "border-r border-white/[.06] px-1 py-1 text-center text-red-300 tabular-nums",
                      sep(i % 7),
                    )}
                  >
                    {openByDate.get(date) ?? ""}
                  </td>
                </Fragment>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** "08:00" → "8a"、"16:30" → "4:30p"（格子窄，跟 preview 一样短写）。 */
function short(hhmm: string): string {
  const full = formatClock(hhmm); // "8:00 AM"
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([AP])M$/i.exec(full);
  if (!m) return full;
  return `${m[1]}${m[2] && m[2] !== "00" ? `:${m[2]}` : ""}${m[3].toLowerCase()}`;
}

function dayLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function rangeLabel(start: string, weeks: number): string {
  const end = shiftYmd(start, weeks * 7 - 1);
  const y = end.slice(0, 4);
  return `${dayLabel(start)} – ${dayLabel(end)}, ${y}`;
}
