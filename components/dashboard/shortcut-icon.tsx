import type { ReactNode } from "react";

import { NAV_MODULES, type NavModuleId } from "@/components/nav/nav-config";

/**
 * My shortcuts 方块左边的 28px 彩色圆图标（Dashboard 改版 preview v15）。
 * 颜色用各模块在侧栏里本来的圆点色（nav-config 的 dot）；没有圆点色的按所在分组给一个。
 */
const GROUP_COLOR: Record<string, string> = {
  Operations: "#38bdf8",
  Notifications: "#3b82f6",
  Activities: "#94a3b8",
  Reports: "#a78bfa",
};

const TRUCK = (
  <>
    <rect x="1" y="3" width="15" height="13" rx="2" />
    <path d="M16 8h4l3 5v3h-7V8z" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </>
);
const BUS = (
  <>
    <path d="M10 17h4V5H2v12h3" />
    <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" />
    <circle cx="7.5" cy="17.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </>
);
const CALENDAR = (
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>
);
const SEND = <path d="M3 11l19-9-9 19-2-8-8-2z" />;
const LIST = (
  <>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </>
);
const DOC = (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M8 13h8M8 17h8" />
  </>
);
const CHART = (
  <>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 5-6" />
  </>
);
const HOME = (
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </>
);
const USER = (
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>
);
const PIN = (
  <>
    <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </>
);
const TICKET = (
  <>
    <path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V6H3z" />
    <path d="M13 6v12" />
  </>
);
const BUG = (
  <>
    <rect x="8" y="7" width="8" height="13" rx="4" />
    <path d="M9 7a3 3 0 0 1 6 0M3 12h5M16 12h5M4 19l4-2M20 19l-4-2M4 5l4 3M20 5l-4 3" />
  </>
);
const CLOCK = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
);
const TAG = (
  <>
    <path d="M20 12 12 20 3 11V3h8z" />
    <circle cx="7.5" cy="7.5" r="1.2" />
  </>
);
const GRID = (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </>
);

const ICONS: Partial<Record<NavModuleId, ReactNode>> = {
  dashboard: GRID,
  workspace: USER,
  forecast: CALENDAR,
  manifests: LIST,
  orders: DOC,
  quotation: TAG,
  dispatch: BUS,
  forms: DOC,
  schedule: CALENDAR,
  daily_report: CHART,
  farm_out_report: SEND,
  morning: TRUCK,
  tour: PIN,
  tickets: TICKET,
  broadcast: SEND,
  order_log: CLOCK,
  send_log: CLOCK,
  broadcast_log: CLOCK,
  sales_report: CHART,
  ops_summary: CHART,
  promotion_stats: CHART,
  bug_reports: BUG,
  task_board: LIST,
};

/** 圆图标的颜色（圆底、描边、图标线条共用）；方块上的浮雕亮边也用同一个色。 */
export function shortcutColor(id: NavModuleId): string {
  const m = NAV_MODULES[id];
  return m.dot ?? GROUP_COLOR[m.group] ?? "#38bdf8";
}

export function ShortcutIcon({ id }: { id: NavModuleId }) {
  return (
    <span
      aria-hidden
      data-shortcut-icon
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--ac)_42%,transparent)] bg-[color-mix(in_srgb,var(--ac)_20%,transparent)] text-[var(--ac)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[15px] fill-none stroke-current stroke-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[id] ?? HOME}
      </svg>
    </span>
  );
}
