import type { ReactNode } from "react";

import {
  CHANNEL_TITLE,
  type ChannelKey,
  type WhatsAppWindow,
} from "@/lib/channels";
import { cn } from "@/lib/utils";

export const WHATSAPP_GREEN = "#25d366";

/** 渠道图标，SVG 与旧后台 channel-icons.js 一致（Annie 2026-09-17 定稿的那一套）。 */
export function ChannelIcon({
  channel,
  dark = false,
  inherit = false,
}: {
  channel: ChannelKey;
  /** 深色底（dashboard，同旧页面 .um-ic.stroke 的 72% 白）。 */
  dark?: boolean;
  /** 三个 tracking 页：同旧页面 channel-icons.js，线条图标用外面文字的颜色、72% 不透明。 */
  inherit?: boolean;
}) {
  const title = CHANNEL_TITLE[channel];
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...(inherit ? { opacity: 0.72 } : {}),
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
    <span
      title={title}
      className={cn(
        "inline-flex items-center",
        inherit ? "" : dark ? "text-white/70" : "text-stone-500",
      )}
    >
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

/** 浅色底的两个 tracking 页（门票 / Tour），照旧页面 channel-icons.js 注入的 .cd.*。 */
const PILL_LIGHT: Record<WhatsAppWindow["state"], string> = {
  open: "border-[#a9ddba] bg-[#e8f7ed] text-[#2e5c3b]",
  soon: "border-[#e9b4b4] bg-[#fae7e7] text-[#a22c2c]",
  shut: "border-[#dee2e6] bg-[#f1f3f5] text-[#5f6a74]",
};
/** 深色的早班 tracking 页：照旧页面 tracking_morning.html 自己覆盖的 .cd.*。 */
const PILL_MORNING: Record<WhatsAppWindow["state"], string> = {
  open: "border-[rgba(46,204,113,.34)] bg-[rgba(46,204,113,.12)] text-[#9fd9b4]",
  soon: "border-[rgba(231,76,60,.40)] bg-[rgba(231,76,60,.14)] text-[#f5a3a3]",
  shut: "border-white/[.14] bg-white/[.05] text-[#8aa9c8]",
};
const PILL_DARK: Record<WhatsAppWindow["state"], string> = {
  open: "border-white/20 bg-white/[.07] text-white/80",
  soon: "border-[#f87171]/40 bg-[#f87171]/[.13] text-[#f87171]",
  shut: "border-white/10 bg-white/[.04] text-white/45",
};

/** WhatsApp 24 小时窗口胶囊：剩很多 / 不到 2 小时（红）/ 已关（写改用哪个渠道）。 */
export function WhatsAppWindowPill({
  win,
  dark = false,
  morning = false,
}: {
  win: WhatsAppWindow;
  /** 深色底（dashboard）：颜色照旧页面 .um-cd.open / .soon / .shut。 */
  dark?: boolean;
  /** 早班 tracking 页（深色底）：颜色照旧页面那一页自己的 .cd.*。 */
  morning?: boolean;
}) {
  // 三种状态三种颜色，刻意不用琥珀色（它已经表示等待时长 / 今明出发）。
  const className = cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold tabular-nums",
    !dark && "tracking-[.02em] whitespace-nowrap",
    (dark ? PILL_DARK : morning ? PILL_MORNING : PILL_LIGHT)[win.state],
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
            <b
              className={
                dark
                  ? "text-white/80"
                  : morning
                    ? "text-[#c8ddf0]"
                    : "text-[#343a40]"
              }
            >
              {win.fallback}
            </b>
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
