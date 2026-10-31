"use client";

import { useState } from "react";

import { formatClock } from "@/components/tasks/config";
import { PageLink } from "@/components/ui/page-link";
import { describeError } from "@/lib/api-errors";
import { LA_TIME_ZONE, laToday } from "@/lib/la-date";
import type { ApiNotice } from "@/lib/notices-api";
import { MESSAGE_MAX, replyTeamMessage } from "@/lib/team-messages-api";
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
  // 同事在 Today's team 点名字发来的站内消息（Annie 2026-10-30「两件都动手」）。
  message: "Message",
};

const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * 今天的写 "12:05 PM"；不是今天的写日期 "Oct 24, 9:50 AM"（Annie 2026-10-25「超过一天就要写日期了」，
 * 不再只写星期——一周以前的只写星期会被看成这周）；不是今年的再带年份。洛杉矶时间。
 */
export function formatNoticeWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const clock = CLOCK.format(date);
  const day = laToday(date);
  const today = laToday();
  if (day === today) return clock;
  const fmt =
    day.slice(0, 4) === today.slice(0, 4) ? MONTH_DAY : MONTH_DAY_YEAR;
  return `${fmt.format(date)}, ${clock}`;
}

/** 卡片 / 历史里的类型标签。 */
export function noticeKindLabel(notice: ApiNotice): string {
  return KIND_LABEL[notice.type] ?? "Notice";
}

/** 通知的链接文字（排班去 /schedule，事故去报告页）。 */
export function noticeLinkLabel(notice: ApiNotice): string {
  return notice.type === "schedule_confirm_request" ||
    notice.type === "schedule_confirm"
    ? "Review my schedule →"
    : notice.type.startsWith("schedule_")
      ? "See my schedule →"
      : notice.type === "operation_report"
        ? "Open report →"
        : "Open →";
}

/** 右上角「Check history」（白边框普通按钮，不是蓝色：蓝色只给提交键）。 */
export function CheckHistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-check-history
      onClick={onClick}
      className="cursor-pointer rounded-[8px] border border-white/30 bg-white/[.04] px-2.5 py-[2px] text-[12.5px] font-semibold text-[#f8fafc] hover:border-white/55"
    >
      Check history
    </button>
  );
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
 * 默认只放今天的通知 + 24 小时内待接受的交接（Annie 2026-10-25「默认都是显示今天的」「交接就是24小时内的」，
 * 由调用方筛好传进来）；以前的在右上角「Check history」里看。没有要看的写 "No new notices today."，不消失。
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
  onOpenHistory,
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
  /** 通知接口可用时才有（404 = 后端没上线，没有历史可看）。 */
  onOpenHistory?: () => void;
}) {
  // 待接受的交接排第一（Annie 2026-10-25「交接排第一」），其后的通知按「最新在最前」（同日「notice消息的排序原则是最新在最前」）；
  // 交接之间也按交出时间最新在前。已读 / 未读不影响顺序。
  const byNewest = (a: Item, b: Item) => itemTime(b) - itemTime(a);
  const items: Item[] = [
    ...handovers
      .map((task): Item => ({ type: "handover", key: `h${task.id}`, task }))
      .sort(byNewest),
    ...schedule
      .map((notice): Item => ({
        type: "schedule",
        key: `s${notice.id}`,
        notice,
      }))
      .sort(byNewest),
  ];

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
        No new notices today.
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {gate?.staffSwitch}
          {onOpenHistory ? (
            <CheckHistoryButton onClick={onOpenHistory} />
          ) : null}
        </span>
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
          {onOpenHistory ? (
            <CheckHistoryButton onClick={onOpenHistory} />
          ) : null}
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
        {/* 交出人设的完成时间（G202 B2）；Accept 后按它排进 My tasks。 */}
        {po?.finish_by ? (
          <span data-finish-by> · Finish by {formatClock(po.finish_by)}</span>
        ) : null}
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
  if (notice.type === "message") {
    return <MessageRow notice={notice} onGotIt={onGotIt} />;
  }
  return (
    <>
      <div className="min-w-0">
        <Kind>{noticeKindLabel(notice)}</Kind>
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
            {noticeLinkLabel(notice)}
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

/**
 * 同事发来的站内消息：全文、Reply（站内回复，只写对方的 Notice，不发邮件——Annie「Q4 A 站内回复，不用邮件」）、Got it。
 * 后端的消息 id 在 ref.message_id（没有就用通知 id 也找不到，这时不出 Reply）。
 */
function MessageRow({
  notice,
  onGotIt,
}: {
  notice: ApiNotice;
  onGotIt: (notice: ApiNotice) => void;
}) {
  const messageId =
    typeof notice.ref?.message_id === "number" ? notice.ref.message_id : null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function send() {
    const body = text.trim();
    if (!body || messageId == null || state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      await replyTeamMessage(messageId, body);
      setState({ kind: "sent" });
      setText("");
      setOpen(false);
    } catch (err) {
      setState({ kind: "error", message: describeError(err) });
    }
  }

  return (
    <>
      <div className="min-w-0">
        <Kind>{noticeKindLabel(notice)}</Kind>
        <p className="text-[13.5px] leading-[1.4] font-semibold">
          {notice.title}
        </p>
      </div>
      <span className="text-[11.5px] whitespace-nowrap tabular-nums">
        {formatNoticeWhen(notice.created_at)}
      </span>
      {notice.body ? (
        <p
          data-message-body
          className="col-span-2 text-[12.5px] leading-[1.55] whitespace-pre-line"
        >
          {notice.body}
        </p>
      ) : null}
      {open ? (
        <div className="col-span-2 mt-1 flex flex-col gap-1.5">
          <textarea
            aria-label="Reply"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MESSAGE_MAX))}
            rows={3}
            disabled={state.kind === "sending"}
            placeholder="Write a reply…"
            className="block w-full resize-none rounded-lg border border-white/15 bg-white/[.04] px-2.5 py-1.5 text-[12.5px] text-white outline-none focus:border-[#185FA5]"
          />
        </div>
      ) : null}
      {state.kind === "sent" ? (
        <p
          role="status"
          className="col-span-2 text-[12px] font-semibold text-[#4ade80]"
        >
          ✓ Reply sent.
        </p>
      ) : state.kind === "error" ? (
        <p role="alert" className="col-span-2 text-[12px] text-[#f87171]">
          Not sent — {state.message}
        </p>
      ) : null}
      <div className="col-span-2 mt-0.5 flex items-center gap-3.5">
        {messageId != null ? (
          open ? (
            <>
              <button
                type="button"
                onClick={() => void send()}
                disabled={!text.trim() || state.kind === "sending"}
                className="cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] px-3 py-[3px] text-[12px] font-semibold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state.kind === "sending" ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={state.kind === "sending"}
                className="cursor-pointer text-[12px] font-semibold text-white/60 hover:text-white"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setState({ kind: "idle" });
              }}
              className="cursor-pointer text-[12.5px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
            >
              Reply
            </button>
          )
        ) : null}
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
