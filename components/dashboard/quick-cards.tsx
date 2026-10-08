import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

interface QuickCard {
  title: string;
  accent: string;
  icon: ReactNode;
  sendHref: string;
  trackHref: string;
}

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

// 已迁到 ops 的页面用站内路径，其余还在旧后台（legacyUrl）；迁过来以后改成站内路径。
const CARDS: readonly QuickCard[] = [
  {
    title: "Morning Pickup",
    accent: "#3b82f6",
    icon: (
      <svg {...ICON_PROPS} className="size-6">
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 5v3h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    sendHref: "/morning-pickup/send",
    trackHref: "/morning-pickup/tracking",
  },
  {
    title: "Bus Tour Confirmation",
    accent: "#22c55e",
    icon: (
      <svg {...ICON_PROPS} className="size-6">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    sendHref: "/tour-confirmation/send",
    trackHref: "/tour-confirmation/tracking",
  },
  {
    title: "Ticket Reminder",
    accent: "#a855f7",
    icon: (
      <svg {...ICON_PROPS} className="size-6">
        <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
        <path d="M13 5v2M13 17v2M13 11v2" />
      </svg>
    ),
    sendHref: "/tickets-reminder/send",
    trackHref: "/tickets-reminder/tracking",
  },
  {
    // 旧页面两个按钮都指向 broadcasting log（发送也在那一页）。
    title: "Broadcast",
    accent: "#f97316",
    icon: (
      <svg {...ICON_PROPS} className="size-6">
        <path d="M3 11l19-9-9 19-2-8-8-2z" />
      </svg>
    ),
    sendHref: "/broadcasting-log",
    trackHref: "/broadcasting-log",
  },
];

// 样式照旧后台 dashboard.html 的 .qcard（Annie 2026-10-07：和旧前端一模一样，深色底）。
// 右上角那个实心圆点（.qcard-badge，旧页面是空的）和箭头也照搬。
export function QuickCards() {
  return (
    <section
      aria-label="Quick actions"
      className="mb-[18px] grid grid-cols-1 gap-3.5 min-[761px]:grid-cols-2 min-[1281px]:grid-cols-4"
    >
      {CARDS.map((card) => (
        <div
          key={card.title}
          style={{ "--ac": card.accent } as CSSProperties}
          className="group relative overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--ac)_38%,rgba(255,255,255,.08))] bg-white/[.032] p-[22px] transition-[border-color,box-shadow,transform,background] duration-200 before:pointer-events-none before:absolute before:-inset-px before:bg-[radial-gradient(circle_at_18%_0%,color-mix(in_srgb,var(--ac)_20%,transparent),transparent_52%)] before:opacity-0 before:transition-opacity before:duration-200 hover:-translate-y-0.5 hover:border-[var(--ac)] hover:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--ac)_8%,transparent),rgba(255,255,255,.025))] hover:shadow-[0_0_36px_color-mix(in_srgb,var(--ac)_20%,transparent)] hover:before:opacity-100"
        >
          <div className="relative mb-6 flex items-center justify-between">
            <div className="flex size-[52px] items-center justify-center rounded-[14px] border border-[color-mix(in_srgb,var(--ac)_38%,transparent)] bg-[color-mix(in_srgb,var(--ac)_12%,transparent)] text-[var(--ac)] transition duration-200 group-hover:shadow-[0_0_22px_color-mix(in_srgb,var(--ac)_30%,transparent)]">
              {card.icon}
            </div>
            <div className="flex items-center gap-[9px]">
              <span
                aria-hidden
                className="size-[26px] rounded-full bg-[var(--ac)]"
              />
              <svg
                {...ICON_PROPS}
                strokeWidth={2.5}
                className="size-4 text-white/40"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </div>
          <h2 className="relative mb-[7px] text-base font-bold text-[#f8fafc]">
            {card.title}
          </h2>
          <div className="relative grid grid-cols-2 gap-[9px]">
            <Link
              href={card.sendHref}
              className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[color-mix(in_srgb,var(--ac)_55%,transparent)] text-[13px] font-semibold text-[var(--ac)] transition duration-150 hover:bg-[var(--ac)] hover:text-white hover:shadow-[0_0_20px_color-mix(in_srgb,var(--ac)_42%,transparent)] active:scale-95"
            >
              <svg {...ICON_PROPS} className="size-3.5 shrink-0">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Send
            </Link>
            <Link
              href={card.trackHref}
              className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-white/[.13] text-[13px] font-semibold text-white/65 transition duration-150 hover:border-white/[.22] hover:bg-white/[.07] hover:text-white active:scale-95"
            >
              <svg {...ICON_PROPS} className="size-3.5 shrink-0">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              Track
            </Link>
          </div>
        </div>
      ))}
    </section>
  );
}
