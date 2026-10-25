"use client";

import { PageLink } from "@/components/ui/page-link";
import { LA_TIME_ZONE, laToday } from "@/lib/la-date";
import type { ApiNotice } from "@/lib/notices-api";
import { cn } from "@/lib/utils";
import type { DailyTask } from "@/types";

import type { BlockGate } from "./widget-gates";

/** 后端以后加的新类型没有专门的名字：标签写 Notice，其余按 title + body 通用显示。 */
const KIND_LABEL: Record<string, string> = {
  schedule_published: "Schedule published",
  schedule_changed: "Schedule changed",
  // 周三确认下周排班（Annie 2026-10-19）。
  schedule_confirm_request: "Confirm your schedule",
  schedule_confirm: "Confirm your schedule",
  operation_report: "Incident logged",
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
  return laToday(date) === laToday()
    ? clock
    : `${WEEKDAY.format(date)} ${clock}`;
}

type Item =
  | { type: "handover"; key: string; task: DailyTask }
  | { type: "schedule"; key: string; notice: ApiNotice };

/** 排序用的时间：交接取交出的时间（pass_over.at），排班通知取 created_at；读不到的排最后。 */
function itemTime(item: Item): number {
  const raw =
    item.type === "handover" ? item.task.pass_over?.at : item.notice.created_at;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

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
  gate,
}: {
  handovers: DailyTask[];
  schedule: ApiNotice[];
  acceptingId: number | null;
  error: string;
  onAccept: (task: DailyTask) => void;
  onGotIt: (notice: ApiNotice) => void;
  onMarkAllRead: () => void;
  /** Super Admin 的「员工可见」开关（标题行右侧）；关着时虚线框。 */
  gate?: BlockGate;
}) {
  // 最新的在最前（Annie 2026-10-25「notice消息的排序原则是最新在最前」）：交接按交出的时间、排班通知按创建时间，
  // 混在一起倒序排；待接受的交接不单独置顶，已读 / 未读不影响顺序。
  const items: Item[] = [
    ...handovers.map((task): Item => ({
      type: "handover",
      key: `h${task.id}`,
      task,
    })),
    ...schedule.map((notice): Item => ({
      type: "schedule",
      key: `s${notice.id}`,
      notice,
    })),
  ].sort((a, b) => itemTime(b) - itemTime(a));

  if (items.length === 0) {
    return (
      <div
        aria-label="Notice"
        role="region"
        data-staff-hidden={gate?.hiddenFromStaff || undefined}
        className={cn(
          "db-section flex h-full flex-wrap items-center justify-between gap-2 rounded-[16px] border px-4 py-2.5 text-[12.5px] text-white/80",
          gate?.hiddenFromStaff
            ? "border-dashed border-[#fbbf24]/50"
            : "border-white/[.14]",
        )}
      >
        No new notices
        {gate?.staffSwitch}
      </div>
    );
  }

  return (
    <aside
      aria-label="Notice"
      data-staff-hidden={gate?.hiddenFromStaff || undefined}
      className={cn(
        "db-section rounded-[16px] border border-[#fbbf24]/50 px-[18px] pt-4 pb-2 hover:border-[#fbbf24]/75",
        gate?.hiddenFromStaff && "border-dashed",
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="db-title flex items-center gap-2 text-[15px]">
          <span
            aria-hidden
            className="size-2 rounded-full bg-[#dc3545] shadow-[0_0_0_3px_rgba(220,53,69,.3),0_0_12px_-1px_#dc3545]"
          />
          Notice
        </h2>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] tabular-nums">
          {gate?.staffSwitch}
          <span>
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
        </span>
      </div>

      {error ? (
        <p role="alert" className="mb-1 text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}

      {/* 横排（Annie 2026-10-24「notice还是横排吧，每条消息都独立一张卡，底部横条可以右移查看」）：
          每条通知一张独立的卡，卡宽固定（不被挤变形），并排成一行；多了，底部出现横向细滚动条，向右移动查看。 */}
      <ul
        data-notice-row
        className="flex [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,.3)_transparent] list-none gap-3 overflow-x-auto pb-2.5"
      >
        {items.map((item) => (
          <li
            key={item.key}
            data-notice-kind={item.type}
            className="grid w-[330px] shrink-0 grid-cols-[minmax(0,1fr)_auto] content-start gap-x-3 gap-y-[3px] rounded-xl border border-white/[.14] bg-white/[.03] px-3.5 py-3"
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
  notice: ApiNotice;
  onGotIt: (notice: ApiNotice) => void;
}) {
  return (
    <>
      <div className="min-w-0">
        <Kind>{KIND_LABEL[notice.type] ?? "Notice"}</Kind>
        <p className="text-[13.5px] leading-[1.4] font-semibold">
          {notice.title}
        </p>
      </div>
      <span className="text-[11.5px] whitespace-nowrap tabular-nums">
        {formatNoticeWhen(notice.created_at)}
      </span>
      {notice.body ? (
        // body 是纯文本、行与行之间 \n：当文本显示，不当 HTML。
        <p className="col-span-2 text-[12.5px] leading-[1.55] whitespace-pre-line">
          {notice.body}
        </p>
      ) : null}
      <div className="col-span-2 mt-0.5 flex items-center gap-3.5">
        {notice.link ? (
          <PageLink
            href={notice.link}
            className="text-[12.5px] font-semibold text-[#38bdf8] no-underline hover:text-[#7dd3fc]"
          >
            {notice.type === "schedule_confirm_request" ||
            notice.type === "schedule_confirm"
              ? "Review my schedule →"
              : notice.type.startsWith("schedule_")
                ? "See my schedule →"
                : notice.type === "operation_report"
                  ? "Open report →"
                  : "Open →"}
          </PageLink>
        ) : null}
        {/* 有按钮要点的（B 期交接）不能用 Got it 关掉。 */}
        {notice.actions.length === 0 ? (
          <button
            type="button"
            onClick={() => onGotIt(notice)}
            className="cursor-pointer rounded-md border border-white/10 px-2.5 py-[3px] text-[12px] font-semibold hover:border-white/35"
          >
            Got it
          </button>
        ) : null}
      </div>
    </>
  );
}
