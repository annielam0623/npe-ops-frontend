import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { legacyUrl } from "./config";

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
    trackHref: legacyUrl("/admin/notifications/tour-confirmation/tracking"),
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

export function QuickCards() {
  return (
    <section
      aria-label="Quick actions"
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
    >
      {CARDS.map((card) => (
        <div
          key={card.title}
          style={{ "--ac": card.accent } as CSSProperties}
          className="rounded-2xl border border-[color-mix(in_srgb,var(--ac)_35%,#e7e5e4)] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[var(--ac)] hover:shadow-[0_0_28px_color-mix(in_srgb,var(--ac)_18%,transparent)]"
        >
          <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--ac)_35%,transparent)] bg-[color-mix(in_srgb,var(--ac)_10%,transparent)] text-[var(--ac)]">
            {card.icon}
          </div>
          <h2 className="mb-5 text-base font-semibold text-stone-900">
            {card.title}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={card.sendHref}
              className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--ac)_55%,transparent)] text-sm font-semibold text-[var(--ac)] transition hover:bg-[var(--ac)] hover:text-white active:scale-95"
            >
              <svg {...ICON_PROPS} className="size-3.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Send
            </Link>
            <Link
              href={card.trackHref}
              className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-stone-300 text-sm font-semibold text-stone-600 transition hover:border-stone-400 hover:bg-stone-50 hover:text-stone-900 active:scale-95"
            >
              <svg {...ICON_PROPS} className="size-3.5">
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
