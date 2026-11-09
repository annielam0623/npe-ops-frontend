"use client";

import { Fragment, useEffect, useState } from "react";

import { SoonTag } from "@/components/nav/app-frame";
import { DARK_SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { laToday, shiftYmd, weekStartYmd } from "@/lib/la-date";
import { fetchScheduleWeek } from "@/lib/schedule-api";
import { SHIFT_SWATCH, shiftColorOf } from "@/lib/schedule-shift-colors";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type { ScheduleEmployee, ScheduleWeek } from "@/types";

import { CARD, CARD_HEADER, DAY_LABELS, MUTED, TIME_OFF_LABEL } from "./config";

/** Period 最多看几周（preview 题：1–8 周）。 */
export const PERIOD_MAX_WEEKS = 8;

type Load =
  | { kind: "loading" }
  | { kind: "ready"; weeks: ScheduleWeek[] }
  | { kind: "error"; message: string };

/**
 * Staff Schedule › Period（Annie 2026-11-08「动手吧」，preview https://claude.ai/artifact/HnBVL6wANcCZYs1r1enq3W，题全 A）：
 * 自己定开始的那一周和周数，把这几周已经排好的周表连起来看（只看不改，点周名回 Schedule 标签改那一周）；
 * 「Auto-fill these weeks」按这次勾选的 Rules 排这几周（AutoFillDialog 的 period 模式）。
 * 「Share with staff」要后端发整段邮件，后端没好之前挂 Soon。可见性开关 schedule_period（默认只 Super Admin）。
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
        if (!controller.signal.aborted) setLoad({ kind: "ready", weeks: list });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setLoad({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [start, weeks, reloadKey, retry, onUnauthorized]);

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
          <button
            type="button"
            data-period-share
            disabled
            className={cn(
              DARK_SECONDARY_BUTTON_CLASS,
              "inline-flex items-center gap-1.5",
            )}
          >
            Share with staff <SoonTag />
          </button>
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
            "Share with staff is coming soon.",
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
}: {
  weeks: ScheduleWeek[];
  employees: ScheduleEmployee[];
  thisWeek: string;
  onOpenWeek: (weekStart: string) => void;
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
