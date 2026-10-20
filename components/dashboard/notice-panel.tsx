"use client";

import { useState } from "react";

import { PageLink } from "@/components/ui/page-link";
import { LA_TIME_ZONE, laToday } from "@/lib/la-date";
import type { ScheduleNotice } from "@/lib/notices-api";
import { cn } from "@/lib/utils";
import type { DailyTask } from "@/types";

import { ROLE_LABEL } from "../tasks/config";

/** 一次最多先摆几条，其余收在「+N more · Show all」后面。 */
const VISIBLE = 3;

const KIND_LABEL: Record<ScheduleNotice["kind"], string> = {
  schedule_published: "Schedule published",
  schedule_changed: "Schedule changed",
};

const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  weekday: "short",
});

/** 今天的写 "12:05 PM"，别的天前面加星期 "Thu 10:42 AM"（洛杉矶时间）。 */
export function formatNoticeWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const clock = CLOCK.format(date);
  return laToday(date) === laToday() ? clock : `${WEEKDAY.format(date)} ${clock}`;
}

type Item =
  | { type: "handover"; key: string; task: DailyTask }
  | { type: "schedule"; key: string; notice: ScheduleNotice };

/**
 * Dashboard 问候语下面的 Notice 面板（Annie 2026-10-19）：需要马上知道的事放在最上面，不用往下滚。
 * - 待接受的交接：直接在这里 Accept（只有 Accept，没有 Decline），接受后才进旁边 My tasks 的清单；
 * - 排班发布 / 改动：Got it 标已读（存服务端），Mark all as read 不碰交接。
 * 没有要看的就写 "No new notices"，不消失（面板位置不跳）。
 */
export function NoticePanel({
  handovers,
  schedule,
  acceptingId,
  error,
  onAccept,
  onGotIt,
  onMarkAllRead,
}: {
  handovers: DailyTask[];
  schedule: ScheduleNotice[];
  acceptingId: number | null;
  error: string;
  onAccept: (task: DailyTask) => void;
  onGotIt: (notice: ScheduleNotice) => void;
  onMarkAllRead: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const items: Item[] = [
    ...handovers.map(
      (task): Item => ({ type: "handover", key: `h${task.id}`, task }),
    ),
    ...[...schedule]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(
        (notice): Item => ({
          type: "schedule",
          key: `s${notice.id}`,
          notice,
        }),
      ),
  ];

  if (items.length === 0) {
    return (
      <div
        aria-label="Notice"
        role="region"
        className="h-full rounded-[16px] border border-white/10 px-4 py-2.5 text-[12.5px] text-white/80"
      >
        No new notices
      </div>
    );
  }

  const shown = showAll ? items : items.slice(0, VISIBLE);

  return (
    <aside
      aria-label="Notice"
      className="h-full rounded-[16px] border-[1.5px] border-[#fbbf24]/75 bg-[#06101c] px-[18px] pt-4 pb-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#fbbf24]">
          <span
            aria-hidden
            className="size-2 rounded-full bg-[#fbbf24] shadow-[0_0_0_3px_rgba(251,191,36,.25)]"
          />
          Notice
        </h2>
        <span className="text-[12.5px] tabular-nums">
          <span data-notice-count>{items.length} new</span>
          {schedule.length > 0 ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={onMarkAllRead}
                className="cursor-pointer text-[12.5px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
              >
                Mark all as read
              </button>
            </>
          ) : null}
        </span>
      </div>

      {error ? (
        <p role="alert" className="mb-1 text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}

      <ul>
        {shown.map((item, i) => (
          <li
            key={item.key}
            data-notice-kind={item.type}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-[3px] py-2.5",
              i > 0 && "border-t border-white/10",
            )}
          >
            {item.type === "handover" ? (
              <HandoverRow
                task={item.task}
                accepting={acceptingId === item.task.id}
                disabled={acceptingId !== null}
                onAccept={() => onAccept(item.task)}
              />
            ) : (
              <ScheduleRow notice={item.notice} onGotIt={onGotIt} />
            )}
          </li>
        ))}
      </ul>

      {!showAll && items.length > VISIBLE ? (
        <p className="border-t border-white/10 pt-2 text-[12px]">
          +{items.length - VISIBLE} more ·{" "}
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="cursor-pointer font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
          >
            Show all
          </button>
        </p>
      ) : null}
    </aside>
  );
}

function Kind({ children }: { children: string }) {
  return (
    <p className="text-[10.5px] font-bold tracking-[.06em] text-[#fbbf24] uppercase">
      {children}
    </p>
  );
}

function HandoverRow({
  task,
  accepting,
  disabled,
  onAccept,
}: {
  task: DailyTask;
  accepting: boolean;
  disabled: boolean;
  onAccept: () => void;
}) {
  const po = task.pass_over;
  return (
    <>
      <div className="min-w-0">
        <Kind>Handover · waiting for you</Kind>
        <p className="text-[13.5px] leading-[1.4] font-semibold">
          {po?.from_display_name ?? "Someone"} passed you &ldquo;{task.title}
          &rdquo;
        </p>
      </div>
      <span className="text-[11.5px] whitespace-nowrap tabular-nums">
        {po ? formatNoticeWhen(po.at) : ""}
      </span>
      <p className="col-span-1 text-[12.5px] leading-[1.55]">
        {po?.note ? <>&ldquo;{po.note}&rdquo; · </> : null}
        From {po?.from_display_name ?? "—"}
        {po ? `, ${ROLE_LABEL[po.from_role]}` : ""}
      </p>
      <div className="col-span-2 mt-0.5 flex items-center gap-3.5">
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="cursor-pointer rounded-md border border-[#fbbf24] bg-[#fbbf24] px-3.5 py-1 text-[12.5px] font-bold text-[#1a1203] hover:bg-[#f5b50f] disabled:cursor-default disabled:opacity-60"
        >
          {accepting ? "Accepting…" : "Accept"}
        </button>
      </div>
    </>
  );
}

function ScheduleRow({
  notice,
  onGotIt,
}: {
  notice: ScheduleNotice;
  onGotIt: (notice: ScheduleNotice) => void;
}) {
  return (
    <>
      <div className="min-w-0">
        <Kind>{KIND_LABEL[notice.kind]}</Kind>
        <p className="text-[13.5px] leading-[1.4] font-semibold">
          {notice.title}
        </p>
      </div>
      <span className="text-[11.5px] whitespace-nowrap tabular-nums">
        {formatNoticeWhen(notice.created_at)}
      </span>
      <div className="col-span-2 mt-0.5 flex items-center gap-3.5">
        <PageLink
          href={notice.href || "/schedule"}
          className="text-[12.5px] font-semibold text-[#38bdf8] no-underline hover:text-[#7dd3fc]"
        >
          See my schedule →
        </PageLink>
        <button
          type="button"
          onClick={() => onGotIt(notice)}
          className="cursor-pointer rounded-md border border-white/10 px-2.5 py-[3px] text-[12px] font-semibold hover:border-white/35"
        >
          Got it
        </button>
      </div>
    </>
  );
}
