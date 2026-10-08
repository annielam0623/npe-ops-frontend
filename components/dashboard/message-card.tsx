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
}: {
  item: UnhandledMessage;
  today: string;
  /** Tour / Tickets 跨今天和未来，写哪天走；Today's Pickup 全是今天的，改写消息几点到。 */
  showDeparture: boolean;
  now: number;
}) {
  const meta: ReactElement[] = [];

  // 顺序：改期徽章（置顶的理由）→ WhatsApp 窗口（过期就没得补）→ 出发日 / 到达时刻。
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

  return (
    <a
      href={trackingHref(item.track_url)}
      style={{ boxShadow: priorityStripes(item) }}
      className="block rounded-xl border border-white/[.09] bg-white/[.022] px-3.5 pt-3 pb-[13px] text-inherit no-underline transition-colors hover:border-[color-mix(in_srgb,var(--ac)_55%,transparent)] hover:bg-white/[.045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13.5px] font-semibold">{item.name}</span>
        <span className="font-mono text-xs text-white/60">
          {item.order_number}
        </span>
      </div>
      {item.trip ? (
        <div className="mt-0.5 text-[12.5px] text-white/60">{item.trip}</div>
      ) : item.trip_fallback ? (
        <div className="mt-0.5 text-[12.5px] text-white/40 italic">
          Pickup: {item.trip_fallback}
        </div>
      ) : null}

      <div className="mt-1.5 mb-[9px] flex flex-wrap items-center gap-[7px]">
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
      <p className="line-clamp-3 text-[13.5px] leading-[1.55] [overflow-wrap:anywhere] text-[#f8fafc]">
        {item.body}
      </p>
      <span className="mt-2 block text-[11.5px] font-semibold tracking-[.01em] text-[color-mix(in_srgb,var(--ac)_78%,#ffffff)]">
        Click to reply →
      </span>
    </a>
  );
}
