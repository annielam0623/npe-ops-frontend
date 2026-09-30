import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { UnhandledMessage } from "@/types";

import {
  CHANNEL_TITLE,
  type ChannelKey,
  channelOf,
  describeDeparture,
  describeWaiting,
  formatClockLa,
  legacyUrl,
  type WhatsAppWindow,
  whatsappWindow,
} from "./config";

const WHATSAPP_GREEN = "#25d366";
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
        className="rounded-full border border-[#fb923c]/40 bg-[#fb923c]/10 px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-[#c2410c] uppercase"
      >
        Date change
      </span>,
    );
  }
  const win = item.channel === "whatsapp" ? whatsappWindow(item, now) : null;
  if (win) {
    meta.push(<WhatsAppWindowPill key="wa" win={win} />);
  }
  if (showDeparture) {
    const departure = describeDeparture(item.tour_date, today);
    if (departure) {
      meta.push(
        <span
          key="departs"
          className={cn(
            "text-[11.5px] tabular-nums",
            departure.soon ? "font-semibold text-amber-600" : "text-stone-500",
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
          className="text-[10.5px] font-semibold tracking-wider text-stone-400 uppercase"
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
      href={legacyUrl(item.track_url)}
      style={{ boxShadow: priorityStripes(item) }}
      className="block rounded-xl border border-stone-200 bg-stone-50/60 px-3.5 pt-3 pb-3 text-inherit no-underline transition-colors hover:border-[color-mix(in_srgb,var(--ac)_55%,transparent)] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13.5px] font-semibold text-stone-900">
          {item.name}
        </span>
        <span className="font-mono text-xs text-stone-500">
          {item.order_number}
        </span>
      </div>
      {item.trip ? (
        <div className="mt-0.5 text-[12.5px] text-stone-500">{item.trip}</div>
      ) : item.trip_fallback ? (
        <div className="mt-0.5 text-[12.5px] text-stone-400 italic">
          Pickup: {item.trip_fallback}
        </div>
      ) : null}

      <div className="mt-1.5 mb-2 flex flex-wrap items-center gap-1.5">
        {meta.map((node) => (
          <span key={node.key} className="inline-flex items-center gap-1.5">
            {node}
            <span aria-hidden className="text-[10px] text-stone-300">
              ·
            </span>
          </span>
        ))}
        {/* 图标说明的就是「这条消息」从哪来，和等待时长捆在一起，中间不加间隔点。 */}
        <span className="inline-flex items-center gap-1.5">
          {channel ? <ChannelIcon channel={channel} /> : null}
          <span className="text-[11.5px] font-semibold text-amber-600 tabular-nums">
            {waiting}
          </span>
        </span>
      </div>

      {/* 截到 3 行：一条话多的客人不能把等了两天的客人顶出窗口；点进去看完整对话。 */}
      <p className="line-clamp-3 text-[13.5px] leading-relaxed [overflow-wrap:anywhere] text-stone-800">
        {item.body}
      </p>
      <span className="mt-2 block text-[11.5px] font-semibold text-[color-mix(in_srgb,var(--ac)_80%,#1c1917)]">
        Click to reply →
      </span>
    </a>
  );
}

function WhatsAppWindowPill({ win }: { win: WhatsAppWindow }) {
  // 三种状态三种颜色，刻意不用琥珀色（它已经表示等待时长 / 今明出发）。
  const className = cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold tabular-nums",
    win.state === "open" && "border-stone-300 bg-stone-100 text-stone-700",
    win.state === "soon" && "border-red-300 bg-red-50 text-red-600",
    win.state === "shut" && "border-stone-200 bg-stone-50 text-stone-400",
  );
  return (
    <span className={className}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="size-[11px] fill-none stroke-current stroke-[2.2]"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      {win.state === "shut" ? (
        <span>
          Window closed · use{" "}
          {win.fallback ? (
            <b className="text-stone-700">{win.fallback}</b>
          ) : (
            "another channel"
          )}
        </span>
      ) : (
        win.label
      )}
    </span>
  );
}

function ChannelIcon({ channel }: { channel: ChannelKey }) {
  const title = CHANNEL_TITLE[channel];
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  let icon: ReactNode;
  switch (channel) {
    case "whatsapp":
      icon = (
        <>
          <path
            d="M12 2.3a9.55 9.55 0 0 0-8.16 14.5L2.45 21.7l5.05-1.32A9.55 9.55 0 1 0 12 2.3Z"
            fill={WHATSAPP_GREEN}
          />
          <path
            d="M9.05 7.5c.26-.02.5.03.68.5l.72 1.65c.1.24.06.5-.1.7l-.47.58c-.16.2-.18.47-.05.69a6.8 6.8 0 0 0 2.8 2.77c.22.12.49.1.69-.07l.6-.48c.2-.16.45-.2.68-.1l1.65.73c.47.2.5.44.48.7-.06.63-.48 1.84-2.22 1.84-2.13 0-6.29-3.39-6.77-6.39-.29-1.84.77-3.1 1.43-3.24Z"
            fill="#fff"
          />
        </>
      );
      break;
    case "sms":
      icon = (
        <g {...stroke}>
          <rect x="7" y="2.6" width="10" height="18.8" rx="2.4" />
          <path d="M10.6 18.6h2.8" />
        </g>
      );
      break;
    case "email":
      icon = (
        <g {...stroke}>
          <rect x="2.6" y="5" width="18.8" height="14" rx="2.2" />
          <path d="M3.4 6.6 12 13l8.6-6.4" />
        </g>
      );
      break;
    case "web":
      icon = (
        <g {...stroke}>
          <circle cx="12" cy="12" r="9.2" />
          <path d="M2.9 12h18.2M12 2.8c2.6 2.6 2.6 15.8 0 18.4-2.6-2.6-2.6-15.8 0-18.4Z" />
        </g>
      );
      break;
  }
  // title 放在外层 span 上：鼠标停上去能看到渠道文字。
  return (
    <span title={title} className="inline-flex items-center text-stone-500">
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label={title}
        className="size-[15px]"
      >
        {icon}
      </svg>
    </span>
  );
}
