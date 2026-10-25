import type { ReactElement } from "react";

import {
  ChannelIcon,
  WHATSAPP_GREEN,
  WhatsAppWindowPill,
} from "@/components/ui/channel-icon";
import { cn } from "@/lib/utils";
import type { UnhandledMessage } from "@/types";

import {
  channelOf,
  describeDeparture,
  describeWaiting,
  formatClockLa,
  trackingHref,
  whatsappWindowOf,
} from "./config";

const MULTI_PINK = "#ec4899";

const MODIFY_ORANGE = "#fb923c";

/**
 * 置顶的理由画成左边一道色条（WhatsApp 绿 / 改期橙，两个都有就两道等宽）。
 * 不做标记的话 staff 只看到顺序变了却说不出原因。
 */
function priorityStripes(item: UnhandledMessage): string | undefined {
  const wa = item.channel === "whatsapp";
  if (wa && item.is_modify) {
    return `inset 3px 0 0 ${WHATSAPP_GREEN}, inset 6px 0 0 -3px ${MODIFY_ORANGE}`;
  }
  if (wa) {
    return `inset 3px 0 0 ${WHATSAPP_GREEN}`;
  }
  if (item.is_modify) {
    return `inset 3px 0 0 ${MODIFY_ORANGE}`;
  }
  return undefined;
}

export function MessageCard({
  item,
  today,
  showDeparture,
  now,
  inlineReply,
  onReply,
}: {
  item: UnhandledMessage;
  /** true = 点卡片（或回车）直接弹对话框；false = 照旧跳 tracking 页（Reply 弹框还没放给这个人，Annie 2026-10-25）。 */
  inlineReply: boolean;
  onReply: (item: UnhandledMessage) => void;
  today: string;
  /** Tour / Tickets 跨今天和未来，写哪天走；Today's Pickup 全是今天的，改写消息几点到。 */
  showDeparture: boolean;
  now: number;
}) {
  const meta: ReactElement[] = [];

  // 顺序：一单多团期的徽章（说明为什么在这一栏）→ 改期徽章（置顶的理由）→
  // WhatsApp 窗口（过期就没得补）→ 出发日 / 到达时刻。
  if (item.kind === "multi_trip") {
    meta.push(
      <span
        key="multi"
        className="rounded-full border px-[7px] py-0.5 text-[10.5px] font-bold"
        style={{
          color: MULTI_PINK,
          borderColor: `${MULTI_PINK}57`,
          background: `${MULTI_PINK}22`,
        }}
      >
        1 order · {(item.dates ?? []).length} dates
      </span>,
    );
  }
  if (item.is_modify) {
    meta.push(
      <span
        key="modify"
        className="rounded-full border border-[#fb923c]/[.34] bg-[#fb923c]/[.13] px-[7px] py-0.5 text-[10.5px] font-bold tracking-[.05em] text-[#fb923c] uppercase"
      >
        Date change
      </span>,
    );
  }
  const win = item.channel === "whatsapp" ? whatsappWindowOf(item, now) : null;
  if (win) {
    meta.push(<WhatsAppWindowPill key="wa" win={win} dark />);
  }
  if (showDeparture) {
    const departure = describeDeparture(item.tour_date, today);
    if (departure) {
      meta.push(
        <span
          key="departs"
          className={cn(
            "text-[11.5px] tabular-nums",
            departure.soon ? "font-semibold text-[#fbbf24]" : "text-white/60",
          )}
        >
          {departure.text}
        </span>,
      );
    }
  } else {
    const clock = formatClockLa(item.created_at);
    if (clock) {
      meta.push(
        <span
          key="clock"
          className="text-[10.5px] font-semibold tracking-[.05em] text-white/40 uppercase"
        >
          {clock}
        </span>,
      );
    }
  }

  const channel = channelOf(item);
  const waiting = describeWaiting(item, now);
  const open = () => {
    if (inlineReply) onReply(item);
    else if (item.track_url)
      window.location.href = trackingHref(item.track_url);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-message-card
      onClick={open}
      onKeyDown={(e) => {
        if (
          e.target === e.currentTarget &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          open();
        }
      }}
      style={{ boxShadow: priorityStripes(item) }}
      className="db-emboss block cursor-pointer rounded-xl border border-white/[.14] px-3 pt-2.5 pb-2.5 text-inherit no-underline hover:border-[color-mix(in_srgb,var(--ac)_55%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {/* 未处理 = 红点（Annie 2026-10-24 全站规则：未读 / 未处理红，已处理绿；这个列表里的都是还欠着回应的）。 */}
        <span
          aria-hidden
          data-status-dot="unhandled"
          className="size-2 shrink-0 self-center rounded-full bg-[#dc3545]"
        />
        <span className="text-[12.5px] font-semibold">{item.name}</span>
        <span className="font-mono text-[11px] text-white/60">
          {item.order_number}
        </span>
      </div>
      {item.trip ? (
        <div className="mt-0.5 text-[11.5px] text-white/60">{item.trip}</div>
      ) : item.trip_fallback ? (
        <div className="mt-0.5 text-[11.5px] text-white/40 italic">
          Pickup: {item.trip_fallback}
        </div>
      ) : null}

      <div className="mt-1 mb-1.5 flex flex-wrap items-center gap-[6px]">
        {meta.map((node) => (
          <span key={node.key} className="inline-flex items-center gap-[7px]">
            {node}
            <span aria-hidden className="text-[10px] text-white/40">
              ·
            </span>
          </span>
        ))}
        {/* 图标说明的就是「这条消息」从哪来，和等待时长捆在一起，中间不加间隔点。 */}
        <span className="inline-flex items-center gap-[5px]">
          {channel ? <ChannelIcon channel={channel} dark /> : null}
          <span className="text-[11.5px] font-semibold text-[#fbbf24] tabular-nums">
            {waiting}
          </span>
        </span>
      </div>

      {/* 截到 3 行：一条话多的客人不能把等了两天的客人顶出窗口；点进去看完整对话。 */}
      <p className="line-clamp-3 text-[12.5px] leading-[1.5] [overflow-wrap:anywhere] text-[#f8fafc]">
        {item.body}
      </p>
      {item.kind === "multi_trip" && item.dates && item.dates.length > 0 ? (
        <ul className="mt-2.5 list-none border-t border-white/[.08] pt-0 pl-0">
          {item.dates.map((d) => {
            const departure = describeDeparture(d, today);
            return (
              <li
                key={d}
                className="border-b border-white/[.06] py-[7px] text-[12.5px] last:border-b-0"
              >
                <span
                  className={cn(
                    "tabular-nums",
                    departure?.soon
                      ? "font-semibold text-[#fbbf24]"
                      : "text-white/60",
                  )}
                >
                  {departure?.text ?? d}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-[.01em] text-[color-mix(in_srgb,var(--ac)_78%,#ffffff)]">
          Click to reply →
        </span>
        {/* 要去 tracking 页看整张表的话还在：小字链接，不抢 Reply。 */}
        {inlineReply && item.track_url ? (
          <a
            href={trackingHref(item.track_url)}
            onClick={(e) => e.stopPropagation()}
            className="text-[10.5px] text-white/45 no-underline hover:text-white hover:underline"
          >
            Tracking page ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
