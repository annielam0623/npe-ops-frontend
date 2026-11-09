"use client";

import { useCallback, useEffect, useState } from "react";

import { DARK_PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { describeError, isStatus } from "@/lib/api-errors";
import { shiftYmd, weekStartYmd } from "@/lib/la-date";
import {
  acceptMyConfirmation,
  fetchMyConfirmation,
  isUnavailable,
  type MyConfirmation,
} from "@/lib/schedule-confirm-api";
import { SHIFT_SWATCH, shiftColorOf } from "@/lib/schedule-shift-colors";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

import { DAY_LABELS, TIME_OFF_LABEL } from "./config";

/** 整段最多几周（同 Period，后端 1–8）。 */
const MAX_WEEKS = 8;

type State =
  | { kind: "loading" }
  | { kind: "bad_link" }
  | { kind: "unavailable" }
  | { kind: "expired" }
  | { kind: "error"; message: string }
  | { kind: "ready"; weeks: MyConfirmation[] };

type Result =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

const DEADLINE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

function md(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function rangeFromUrl(): { start: string; weeks: number } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const start = q.get("start") ?? "";
  const weeks = Number(q.get("weeks"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) return null;
  return { start: weekStartYmd(start), weeks };
}

/** 这一周算不算「确认了」：自己按了 Looks good。 */
function isConfirmed(w: MyConfirmation): boolean {
  return w.my_response?.answer === "accepted";
}

/** 还能一起按「Confirm all」的周：开着、还没确认。 */
function needsConfirm(w: MyConfirmation): boolean {
  return w.open && !isConfirmed(w);
}

/**
 * 整段确认（staff，邮件里的链接，不用登录）：Annie 2026-11-08 preview HnBVL6wANcCZYs1r1enq3W ③，全 A——
 * 只看自己的班、一周一块；底下一个蓝键「Confirm all N weeks」一次确认（逐周调现有的 accept，后端 33 不另开整段接口）；
 * 哪天要改点那天的 Request change，打开那一周的确认页（同一个 token），照现在每周的做法提改动。
 * 过了期限 / 已开始的周只读、写 Closed。
 */
export function PeriodConfirmView({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [range, setRange] = useState<{ start: string; weeks: number } | null>(
    null,
  );

  const load = useCallback(
    async (r: { start: string; weeks: number }) => {
      try {
        const weeks: MyConfirmation[] = [];
        for (let i = 0; i < r.weeks; i++) {
          weeks.push(
            await fetchMyConfirmation({
              week: shiftYmd(r.start, i * 7),
              token,
            }),
          );
        }
        setState({ kind: "ready", weeks });
      } catch (e) {
        if (isUnavailable(e)) setState({ kind: "unavailable" });
        else if (isStatus(e, 401) || isStatus(e, 403) || isStatus(e, 410))
          setState({ kind: "expired" });
        else setState({ kind: "error", message: describeError(e) });
      }
    },
    [token],
  );

  useEffect(() => {
    const r = rangeFromUrl();
    if (!r) {
      setState({ kind: "bad_link" });
      return;
    }
    setRange(r);
    void load(r);
  }, [load]);

  async function confirmAll(weeks: MyConfirmation[]) {
    setResult({ kind: "busy" });
    const next = [...weeks];
    for (let i = 0; i < next.length; i++) {
      if (!needsConfirm(next[i])) continue;
      try {
        next[i] = await acceptMyConfirmation({
          week: next[i].week_start,
          token,
        });
        setState({ kind: "ready", weeks: [...next] });
      } catch (e) {
        setResult({
          kind: "error",
          message: `Week of ${md(next[i].week_start)}: ${describeError(e)}`,
        });
        return;
      }
    }
    setResult({ kind: "ok" });
  }

  let body: React.ReactNode = null;
  if (state.kind === "loading")
    body = <p className="text-white/70">Loading your schedule…</p>;
  else if (state.kind === "bad_link")
    body = (
      <p className="font-semibold">
        This link is not complete. Ask the office to send it again.
      </p>
    );
  else if (state.kind === "unavailable")
    body = <p className="font-semibold">This page is not available yet.</p>;
  else if (state.kind === "expired")
    body = (
      <p className="font-semibold">
        This link has expired. Ask the office to send you a new one.
      </p>
    );
  else if (state.kind === "error")
    body = (
      <p className="font-semibold text-red-200">
        Could not load your schedule: {state.message}
      </p>
    );
  else if (state.kind === "ready" && range) {
    const weeks = state.weeks;
    const name = weeks[0]?.person.name ?? "";
    const shifts = weeks.reduce(
      (n, w) => n + w.slots.filter((s) => s.mine).length,
      0,
    );
    const todo = weeks.filter(needsConfirm).length;
    const allDone = weeks.every(isConfirmed);
    body = (
      <div className="flex flex-col gap-3.5">
        <div>
          <h1 className="text-[20px] font-bold text-white">
            Hi {name}, your schedule
          </h1>
          <p className="text-[13px] text-white/70">
            {md(range.start)} – {md(shiftYmd(range.start, range.weeks * 7 - 1))}{" "}
            · {range.weeks} week{range.weeks === 1 ? "" : "s"} · {shifts} shift
            {shifts === 1 ? "" : "s"}
          </p>
        </div>
        {weeks.map((w) => (
          <WeekCard key={w.week_start} week={w} token={token} />
        ))}
        {result.kind === "error" ? (
          <p role="alert" className="text-[13px] font-semibold text-[#f87171]">
            {result.message}
          </p>
        ) : null}
        {result.kind === "ok" || (allDone && result.kind === "idle") ? (
          <p
            data-period-confirmed
            className="text-[14px] font-semibold text-[#4ade80]"
          >
            {result.kind === "ok"
              ? "Confirmed. Thank you!"
              : "All weeks are confirmed. Thank you!"}
          </p>
        ) : null}
        {todo > 0 ? (
          <button
            type="button"
            data-period-confirm-all
            disabled={result.kind === "busy"}
            onClick={() => void confirmAll(weeks)}
            className={cn(DARK_PRIMARY_BUTTON_CLASS, "w-full py-3 text-[15px]")}
          >
            {result.kind === "busy"
              ? "Confirming…"
              : todo === weeks.length
                ? `Confirm all ${weeks.length} week${weeks.length === 1 ? "" : "s"}`
                : `Confirm the other ${todo} week${todo === 1 ? "" : "s"}`}
          </button>
        ) : null}
        <details className="rounded-[10px] border border-white/[.12] bg-[#1a2f4a] px-4 py-3 text-[12.5px] leading-[1.8] text-[#c8ddf0]">
          <summary className="cursor-pointer font-semibold text-[#7ab3e0]">
            📖 How to use
          </summary>
          <ol className="mt-1.5 list-decimal pl-[18px]">
            <li>
              These are your shifts for the weeks shown, one block a week.
            </li>
            <li>
              If they look right, tap Confirm all. Every open week is confirmed
              at once.
            </li>
            <li>
              To change a day, tap Request change on that day. That week opens
              with all its shifts, so you can ask to swap, move or add a shift.
            </li>
            <li>
              A week shows Closed after its confirm deadline or once it has
              started. Ask your supervisor for changes then.
            </li>
          </ol>
        </details>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#06101c] p-4 text-white/90 sm:p-7">
      <div className="mx-auto max-w-[520px]">{body}</div>
    </main>
  );
}

function WeekCard({ week, token }: { week: MyConfirmation; token: string }) {
  const mine = week.slots.filter((s) => s.mine);
  const me = week.person.employee_id;
  const typeLabel = (k: string) =>
    week.shift_types.find((t) => t.key === k)?.label ?? k;
  const status = !week.open
    ? { text: "Closed", cls: "text-white/50", key: "closed" }
    : isConfirmed(week)
      ? { text: "Confirmed", cls: "text-[#4ade80]", key: "confirmed" }
      : week.my_response?.answer === "wants_changes"
        ? { text: "Change requested", cls: "text-[#fbbf24]", key: "changes" }
        : { text: "Not confirmed", cls: "text-[#f87171]", key: "not_yet" };
  const changeHref = `/schedule/confirm/link/${encodeURIComponent(token)}?week=${week.week_start}`;

  return (
    <section
      data-period-confirm-week={week.week_start}
      data-week-status={status.key}
      className="rounded-[12px] border border-white/10 bg-white/[.04] px-3.5 py-3"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-bold text-white">
          Week of {md(week.week_start)}
        </h2>
        <span className={cn("text-[12.5px] font-semibold", status.cls)}>
          {status.text}
        </span>
      </div>
      {week.open ? (
        <p className="mb-1.5 text-[11.5px] text-white/50">
          Confirm by {DEADLINE_FMT.format(new Date(week.deadline))}
        </p>
      ) : null}
      <ul className="flex flex-col">
        {Array.from({ length: 7 }, (_, d) => {
          const date = shiftYmd(week.week_start, d);
          const day = mine
            .filter((s) => s.date === date)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          const off = week.time_off.find(
            (t) => t.employee_id === me && t.date === date,
          );
          return (
            <li
              key={date}
              data-period-day={date}
              className="grid grid-cols-[64px_1fr_auto] items-center gap-2 border-t border-white/[.06] py-1.5 text-[13px] first:border-t-0"
            >
              <span className="text-white/70">
                {DAY_LABELS[d]} {Number(date.slice(8))}
              </span>
              <span className="flex flex-wrap gap-1">
                {day.length ? (
                  day.map((s) => (
                    <span
                      key={s.id}
                      className="rounded-[5px] px-1.5 text-[12px] text-white tabular-nums"
                      style={{
                        background: SHIFT_SWATCH[shiftColorOf(s.shift_type)],
                      }}
                    >
                      {typeLabel(s.shift_type)} · {formatClock(s.start_time)}–
                      {formatClock(s.end_time)}
                    </span>
                  ))
                ) : off ? (
                  <span className="text-[12px] text-[#fcd34d]">
                    {TIME_OFF_LABEL[off.kind ?? ""] ?? "Off"}
                  </span>
                ) : (
                  <span className="text-white/30">Off</span>
                )}
              </span>
              {week.open ? (
                <a
                  href={changeHref}
                  data-period-request-change
                  className="rounded-[6px] border border-[#7ab3e0]/40 px-1.5 text-[11.5px] text-[#7ab3e0]"
                >
                  Request change
                </a>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
