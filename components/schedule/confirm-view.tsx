"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { CenteredPage } from "@/components/ui/centered-page";
import { Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { shiftYmd } from "@/lib/la-date";
import {
  acceptMyConfirmation,
  fetchMyConfirmation,
  isUnavailable,
  type MyConfirmation,
  submitMyChanges,
} from "@/lib/schedule-confirm-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { formatRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

import {
  type BoardAddition,
  type BoardPerson,
  type BoardShift,
  CHIP_MIME,
  ConfirmBoard,
} from "./confirm-board";
import { CARD, CARD_HEADER, DAY_LABELS, MUTED } from "./config";

type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "expired" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MyConfirmation };

function weekFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const w = new URLSearchParams(window.location.search).get("week");
  return w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : undefined;
}

/**
 * 周三确认下周排班（员工这一边，Annie 2026-10-19「现在动手」）：只读看下周的班，点 Accept；
 * 要改就点 Change，把自己的名字拖到想上的那天，该格子里变成两个人，新加的（自己）用亮黄色底。
 * 只加不减，一次发送，发出去以后不能再改（等排班的人 Approve / Decline）。
 * 两种进法：登录后（站内提醒里的链接）、邮件里的一人一条链接（token，不用登录）。
 * 接口还没上线（404）时只写一句 Nothing to confirm，不报错。
 */
export function ConfirmView({ token }: { token?: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [mode, setMode] = useState<"idle" | "change">("idle");
  const [adds, setAdds] = useState<{ date: string; shift: string }[]>([]);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyConfirmation({ week: weekFromUrl(), token });
      setState({ kind: "ready", data });
    } catch (e) {
      if (isUnavailable(e)) setState({ kind: "unavailable" });
      else if (isStatus(e, 401) || isStatus(e, 403) || isStatus(e, 410)) {
        if (token) setState({ kind: "expired" });
        else
          window.location.href = buildLegacyLoginRedirectUrl(
            window.location.href,
          );
      } else setState({ kind: "error", message: describeError(e) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = state.kind === "ready" ? state.data : null;

  const board = useMemo(() => {
    if (!data) return null;
    const dates = DAY_LABELS.map((_, i) => shiftYmd(data.week_start, i));
    const types = data.shift_types.filter((t) =>
      data.slots.some((s) => s.shift_type === t.key),
    );
    const shifts: BoardShift[] = types.map((t) => {
      const first = data.slots
        .filter((s) => s.shift_type === t.key)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      return {
        key: t.key,
        label: t.label,
        time: first ? formatRange(first.start_time, first.end_time) : "",
      };
    });
    const people: Record<string, BoardPerson[]> = {};
    for (const s of data.slots) {
      const k = `${s.date}|${s.shift_type}`;
      (people[k] ??= []).push({
        name: s.employee_name,
        me: s.employee_id === data.person.employee_id,
      });
    }
    const mine = data.slots
      .filter((s) => s.employee_id === data.person.employee_id)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(
        (s) =>
          `${DAY_LABELS[dates.indexOf(s.date)] ?? s.date} ${
            data.shift_types.find((t) => t.key === s.shift_type)?.label ??
            s.shift_type
          }`,
      );
    return { shifts, people, mine };
  }, [data]);

  const additions: BoardAddition[] = useMemo(() => {
    if (!data) return [];
    const sent = (data.my_response?.requests ?? []).map((r): BoardAddition => ({
      id: `r${r.id}`,
      date: r.date,
      shift: r.shift_type,
      name: data.person.name,
      status: r.status,
    }));
    const drafts = adds.map((a): BoardAddition => ({
      id: `d${a.date}|${a.shift}`,
      date: a.date,
      shift: a.shift,
      name: data.person.name,
      status: "draft",
      onRemove: () =>
        setAdds((cur) =>
          cur.filter((x) => !(x.date === a.date && x.shift === a.shift)),
        ),
    }));
    return [...sent, ...drafts];
  }, [data, adds]);

  function dropOn(date: string, shift: string) {
    if (!data) return;
    // 已经在这个格子里（原来就排了你）或已经加过，不重复。
    if (
      data.slots.some(
        (s) =>
          s.date === date &&
          s.shift_type === shift &&
          s.employee_id === data.person.employee_id,
      ) ||
      adds.some((a) => a.date === date && a.shift === shift)
    )
      return;
    setAdds((cur) => [...cur, { date, shift }]);
    setArmed(false);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("idle");
      setAdds([]);
      await load();
    } catch (e) {
      if (isStatus(e, 401) && !token) {
        window.location.href = buildLegacyLoginRedirectUrl(
          window.location.href,
        );
        return;
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const answered = data?.my_response ?? null;
  const closed = data ? data.open === false && !answered : false;

  const body = (() => {
    if (state.kind === "loading") return <Panel dark>Loading…</Panel>;
    if (state.kind === "unavailable")
      return (
        <Panel dark>
          <p className="font-semibold">Nothing to confirm right now.</p>
        </Panel>
      );
    if (state.kind === "expired")
      return (
        <Panel dark>
          <p className="font-semibold">
            This link has expired. Ask the office to send you a new one.
          </p>
        </Panel>
      );
    if (state.kind === "error")
      return (
        <Panel dark>
          <p className="font-semibold text-red-200">
            Could not load your schedule: {state.message}
          </p>
        </Panel>
      );
    if (!data || !board) return null;
    const mineText = board.mine.length
      ? `You're on: ${board.mine.join(" · ")}`
      : "You have no shifts next week.";
    return (
      <section className={CARD} data-confirm>
        <div className={CARD_HEADER}>
          <h2 className="text-[15px] font-semibold text-white">
            Confirm your schedule · {data.week_start.slice(5).replace("-", "/")}{" "}
            – {shiftYmd(data.week_start, 6).slice(5).replace("-", "/")}
          </h2>
          <span
            data-confirm-status
            className={cn(
              "rounded-[8px] border px-3 py-1.5 text-[12.5px]",
              answered
                ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
                : "border-amber-300/35 bg-amber-300/10 text-amber-200",
            )}
          >
            {answered
              ? answered.answer === "accepted"
                ? "Accepted · sent to the person in charge"
                : "Changes sent · waiting for the person in charge"
              : closed
                ? "Closed"
                : "Waiting for your answer"}
          </span>
        </div>

        {!answered && !closed ? (
          <div className="flex flex-col gap-2.5 px-4 pt-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] text-white/85" data-confirm-mine>
                {mineText}
              </span>
              <span className="flex-1" />
              {mode === "idle" ? (
                <>
                  <button
                    type="button"
                    data-confirm-accept
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        acceptMyConfirmation({ week: data.week_start, token }),
                      )
                    }
                    className={DARK_PRIMARY_BUTTON_CLASS}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    data-confirm-change
                    disabled={busy}
                    onClick={() => setMode("change")}
                    className={DARK_SECONDARY_BUTTON_CLASS}
                  >
                    Change
                  </button>
                </>
              ) : null}
            </div>
            {mode === "change" ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  data-confirm-chip
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(CHIP_MIME, "me");
                    e.dataTransfer.setData("text/plain", data.person.name);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => setArmed((a) => !a)}
                  className={cn(
                    "inline-flex cursor-grab items-center gap-2 rounded-full bg-[#fcd34d] px-3.5 py-1.5 text-[13px] font-bold text-[#1c1400] select-none",
                    armed && "ring-2 ring-white",
                  )}
                >
                  ⠿ {data.person.name}
                  <small className="font-medium">drag me onto a day</small>
                </span>
                <span className="text-[12.5px] text-amber-200">
                  Drop your name on the day and shift you want. You&apos;ll
                  appear next to whoever is already there.
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  data-confirm-send
                  disabled={busy || adds.length === 0}
                  onClick={() =>
                    void run(() =>
                      submitMyChanges({
                        week: data.week_start,
                        token,
                        additions: adds.map((a) => ({
                          date: a.date,
                          shift_type: a.shift,
                        })),
                      }),
                    )
                  }
                  className={DARK_PRIMARY_BUTTON_CLASS}
                >
                  {busy ? "Sending…" : "Send my changes"}
                </button>
                <button
                  type="button"
                  data-confirm-cancel
                  disabled={busy}
                  onClick={() => {
                    setMode("idle");
                    setAdds([]);
                    setArmed(false);
                  }}
                  className={DARK_SECONDARY_BUTTON_CLASS}
                >
                  Cancel
                </button>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-[13px] text-red-200">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <p className={cn("px-4 pt-3 text-[13px]", MUTED)}>
            {mineText}
            {answered?.answer === "wants_changes"
              ? " The extra shifts you asked for are in yellow until the person in charge answers."
              : ""}
          </p>
        )}

        <ConfirmBoard
          weekStart={data.week_start}
          shifts={board.shifts}
          people={board.people}
          additions={additions}
          droppable={mode === "change"}
          armed={armed}
          onDropOn={dropOn}
        />
      </section>
    );
  })();

  if (token)
    return (
      <main className="min-h-screen bg-[#06101c] p-4 text-white/90 sm:p-7">
        <div className="mx-auto max-w-[1100px]">{body}</div>
      </main>
    );
  return (
    <main className="text-white/90">
      <CenteredPage className="flex flex-col gap-5">
        <h1 className="text-[29px] font-bold tracking-[-.02em] text-white">
          Staff Schedule
        </h1>
        {body}
      </CenteredPage>
    </main>
  );
}
