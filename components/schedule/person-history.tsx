"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { fetchPersonHistory } from "@/lib/schedule-history-api";
import { cn } from "@/lib/utils";
import type { ScheduleHistoryEvent } from "@/types/schedule-history";

import { DAY_LABELS } from "./config";

/**
 * 排班：每个人这一周的往来记录（Annie 2026-10-30「单独发给某人，就像信息一样保留每次交流的过程……一个简单的log」，
 * 「其他都同意推荐，动手」；preview https://claude.ai/artifact/T98GQ9KfQuQfrEcMv6XgzM ）。
 * 两处共用：Send to confirm 发送框改动表下面、Responses 卡每人一行 History 展开。
 * 只看这一周；最新的在最下面，打开时滚到底；记发的 / 回的 / 主管处理 / 重置，不记格子改动（后端只写这几种）。
 * 颜色照 preview：系统灰标签；员工本人绿底；用排班页的人蓝字标签。结果字：Looks good / Approved 绿、Declined 红、要改的琥珀色。
 */

const WHEN_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "numeric",
  day: "numeric",
});
const WHEN_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

/** "Wed 10/28" / "9:00 AM"（洛杉矶时间）。 */
function whenParts(iso: string): [string, string] {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [iso, ""];
  return [WHEN_DAY.format(d).replace(",", ""), WHEN_TIME.format(d)];
}

/** "2026-11-04" → "Wed 11/4"（同发送框、后端邮件的写法，不补零）。 */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return `${DAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
}

/** 没给班型表时：mid → Mid。 */
const defaultShiftLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

const CHANNEL: Record<string, string> = {
  email: "email",
  in_app: "in-app",
  sms: "SMS",
};
const channels = (list: readonly string[]) =>
  list.map((c) => CHANNEL[c] ?? c).join(" + ");

const TAG: Record<ScheduleHistoryEvent["by_kind"], [string, string]> = {
  system: ["system", "bg-[#eef2f7] text-[#475569]"],
  employee: ["staff", "bg-[#e6f4f1] text-[#0f766e]"],
  staff: ["supervisor", "bg-[#e8f0fb] text-[#185FA5]"],
};

const GOOD = "font-semibold text-[#15803d]";
const CHANGE = "font-semibold text-[#BA7517]";
const BAD = "font-semibold text-[#A32D2D]";
const SUB = "text-[12px] text-[#6b7280]";

function Lines({ lines }: { lines: readonly string[] }) {
  if (!lines.length) return null;
  return (
    <ul data-history-lines className="m-0 list-disc pl-4 text-[12.5px]">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function sentBy(e: ScheduleHistoryEvent): string {
  return e.channels.length ? ` (${channels(e.channels)})` : "";
}

/** 一条记录的正文（英文，给 staff 看）。后端给的 lines / title 照原样，当纯文本显示。 */
function Body({
  e,
  name,
  shiftLabel,
}: {
  e: ScheduleHistoryEvent;
  name: string;
  shiftLabel: (key: string) => string;
}) {
  const req = e.request
    ? `${dayLabel(e.request.date)} ${shiftLabel(e.request.shift_type)}`
    : "";
  const via =
    e.via === "link" ? "from the link" : e.via === "login" ? "logged in" : "";
  const failed = e.failed?.length ? (
    <span data-history-failed className={BAD}>
      Not delivered: {channels(e.failed)}
    </span>
  ) : null;
  switch (e.kind) {
    case "confirm_sent":
      return (
        <>
          <span>
            Sent the weekly confirm{sentBy(e)}
            {e.title ? (
              <>
                : <i>{e.title}</i>
              </>
            ) : null}
          </span>
          <Lines lines={e.lines} />
          {failed}
        </>
      );
    case "published":
    case "republished":
      return (
        <>
          <span>
            {e.kind === "published" ? "Published" : "Published again"}
            {sentBy(e)}.
            {e.title ? (
              <>
                {" "}
                {name} got: <i>{e.title}</i>
              </>
            ) : null}
          </span>
          <Lines lines={e.lines} />
          {failed}
        </>
      );
    case "changes_sent":
      return (
        <>
          <span>Sent to confirm{sentBy(e)}:</span>
          <Lines lines={e.lines} />
          {failed}
        </>
      );
    case "answer_reset":
      return (
        <span className={SUB}>
          {name}&rsquo;s Looks good was reset to No answer.
        </span>
      );
    case "answered":
      return (
        <span>
          {e.answer === "wants_changes" ? (
            <span className={CHANGE}>Send my changes</span>
          ) : (
            <span className={GOOD}>Looks good</span>
          )}
          {via ? <span className={SUB}> · {via}</span> : null}
        </span>
      );
    case "requested":
      return (
        <span>
          <span className={CHANGE}>Asked for</span> {req}
          {via ? <span className={SUB}> · {via}</span> : null}
        </span>
      );
    case "approved":
      return (
        <span>
          <span className={GOOD}>Approved</span> {req}
        </span>
      );
    case "declined":
      return (
        <span>
          <span className={BAD}>Declined</span> {req}
        </span>
      );
    default:
      return <Lines lines={e.lines} />;
  }
}

/** 记录本身：标题一行、从旧到新、打开时滚到最底。没有记录写一句灰字。 */
export function HistoryThread({
  name,
  weekStart,
  events,
  shiftLabel = defaultShiftLabel,
}: {
  name: string;
  weekStart: string;
  events: readonly ScheduleHistoryEvent[];
  shiftLabel?: (key: string) => string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [events]);
  return (
    <div
      ref={boxRef}
      data-history
      className="max-h-[420px] overflow-auto rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] text-[13px] text-[#1a1a1a]"
    >
      <div className="sticky top-0 z-[1] flex items-baseline justify-between gap-2 border-b border-[#e5e7eb] bg-white px-3 py-2 text-[13px] font-semibold">
        History with {name} · week of {weekStart}
        <span className="text-[12px] font-normal text-[#6b7280]">
          newest at the bottom
        </span>
      </div>
      {events.length ? (
        events.map((e) => {
          const [day, time] = whenParts(e.at);
          const [tag, tagClass] = TAG[e.by_kind] ?? TAG.staff;
          return (
            <div
              key={e.id}
              data-history-event={e.kind}
              data-by-kind={e.by_kind}
              className={cn(
                "grid grid-cols-[76px_1fr] gap-2.5 border-b border-[#eef0f2] px-3 py-2 last:border-b-0 max-[520px]:grid-cols-1 max-[520px]:gap-0.5",
                e.by_kind === "employee" && "bg-[#f2f8f6]",
              )}
            >
              <div className="font-mono text-[12px] leading-[1.45] text-[#6b7280] tabular-nums">
                {day}
                <br />
                {time}
              </div>
              <div className="grid gap-[3px]">
                <div data-history-who className="font-semibold">
                  {e.by ?? "System"}
                  <span
                    data-history-tag
                    className={cn(
                      "ml-1.5 rounded-[5px] px-1.5 py-px align-[1px] text-[10.5px] font-semibold",
                      tagClass,
                    )}
                  >
                    {tag}
                  </span>
                </div>
                <div data-history-body className="grid gap-[3px]">
                  <Body e={e} name={name} shiftLabel={shiftLabel} />
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <p
          data-history-empty
          className="m-0 px-3 py-2.5 text-[12.5px] text-[#6b7280]"
        >
          Nothing yet for this week. Sends, answers and decisions show up here.
        </p>
      )}
    </div>
  );
}

export type HistoryState =
  | { kind: "loading" }
  | { kind: "ready"; events: ScheduleHistoryEvent[] }
  /** 403（没有 schedule.edit）/ 404（没发布、后端还没上）：不显示。 */
  | { kind: "hidden" }
  | { kind: "error"; message: string };

/** 读一个人这一周的记录。enabled=false 时不读。 */
export function usePersonHistory(
  weekStart: string,
  employeeId: number,
  onUnauthorized: () => void,
  enabled = true,
  reloadKey = 0,
): HistoryState {
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  const unauthRef = useRef(onUnauthorized);
  unauthRef.current = onUnauthorized;
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    setState({ kind: "loading" });
    fetchPersonHistory(weekStart, employeeId, c.signal)
      .then((h) => setState({ kind: "ready", events: h.events }))
      .catch((e: unknown) => {
        if (c.signal.aborted) return;
        if (isStatus(e, 401)) unauthRef.current();
        else if (isStatus(e, 403) || isStatus(e, 404))
          setState({ kind: "hidden" });
        else setState({ kind: "error", message: describeError(e) });
      });
    return () => c.abort();
  }, [weekStart, employeeId, enabled, reloadKey]);
  return state;
}

/** 读不到时的红字（后端原话）。 */
export function HistoryError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      data-history-error
      className="m-0 text-[12.5px] text-[#A32D2D]"
    >
      Could not load the history: {message}
    </p>
  );
}

/** 发送框里用：自己读、自己画。没权限 / 没发布就什么都不画。 */
export function PersonHistory({
  weekStart,
  employeeId,
  name,
  shiftLabel,
  onUnauthorized,
  reloadKey = 0,
}: {
  weekStart: string;
  employeeId: number;
  name: string;
  shiftLabel?: (key: string) => string;
  onUnauthorized: () => void;
  reloadKey?: number;
}) {
  const state = usePersonHistory(
    weekStart,
    employeeId,
    onUnauthorized,
    true,
    reloadKey,
  );
  if (state.kind === "hidden") return null;
  if (state.kind === "error") return <HistoryError message={state.message} />;
  if (state.kind === "loading")
    return <p className="m-0 text-[12.5px] text-[#6b7280]">Loading history…</p>;
  return (
    <HistoryThread
      name={name}
      weekStart={weekStart}
      events={state.events}
      shiftLabel={shiftLabel}
    />
  );
}
