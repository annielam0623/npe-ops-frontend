import type { GateKey } from "@/lib/page-gates";

/**
 * 侧栏导航（dashboard 改版阶段一，Annie 2026-10-11 审过的设计 docs/dashboard-改版_阶段一设计.md §2.1 / §2.2）。
 *
 * - **代码里只固定「条目 id ↔ 页面路径」**（路由，不是业务值）。名字、分组、顺序、显不显示、默认快捷方式都是配置：
 *   后端 `GET /api/nav-config`（superadmin 在 Settings → Navigation 改）；接口没好之前用下面和种子数据完全一样的 `DEFAULT_NAV_CONFIG`。
 * - Settings 组（只 admin）和 Messages（旧后台）不进配置，照旧写在这里。
 * - 链接一律走 `lib/page-switch.ts`（分批切换）：已切换 ⇒ ops 新页面；没切换 ⇒ 同一个网址下的旧路径。
 */
export interface NavItem {
  label: string;
  href?: string;
  /** 链回旧后台（href 是旧后台路径）。 */
  legacy?: boolean;
  /** 这些路径开头的页面也算这一项（例：tracking 页算在 Send 那一项下）。 */
  match?: string[];
  /** 旧后台里的占位页（Settings → General）：显示成 Coming soon、不可点。 */
  soon?: boolean;
  /** 只认 href 本身（不认 href/... 下面的页面）：/dispatch 不能把 /dispatch/work-sheet 也算进来。 */
  exact?: boolean;
  /** 只有 superadmin 看得到（Settings → Navigation）。 */
  superadminOnly?: boolean;
  /** Settings 组里主管（supervisor）也看得到的项；其余 Settings 项只有 admin 看得到。 */
  supervisorVisible?: boolean;
}

/** 能配置、能拖到 My shortcuts、能钉住的条目。id 是给后端存的字符串，定了就别改（员工的快捷方式存的是 id）。 */
export const NAV_MODULE_IDS = [
  "dashboard",
  "workspace",
  "forecast",
  "manifests",
  "orders",
  "quotation",
  "dispatch",
  "forms",
  "schedule",
  "daily_report",
  "farm_out_report",
  "morning",
  "tour",
  "tickets",
  "broadcast",
  "tracking_widget",
  "tracking_hidden",
  "order_log",
  "send_log",
  "broadcast_log",
  "sales_report",
  "ops_summary",
  "promotion_stats",
  "bug_reports",
  "task_board",
] as const;

export type NavModuleId = (typeof NAV_MODULE_IDS)[number];

export interface NavModule extends NavItem {
  id: NavModuleId;
  /** 种子数据里的分组（配置里没有这个 id 时，放回这一组）。 */
  group: string;
  /** 还没有页面（Annie 2026-10-11）：标 SOON，照样能点、能拖、能钉，点了进占位页。 */
  upcoming?: boolean;
  /** 侧栏 / 快捷方式上的彩色圆点。 */
  dot?: string;
  /**
   * 侧栏里保留、可点，但没有拖拽把手和钉子，也不能进 My shortcuts（Annie 2026-10-19：Morning / Tour / Tickets
   * 的入口已经在 Tracking 小部件里了）。
   */
  noPin?: boolean;
  /** 内部条目：不进侧栏、不进 Settings → Navigation（Tracking 小部件本身，和「用户删掉了小部件」的记号）。 */
  internal?: boolean;
  /** 侧栏里不高亮这一项（Broadcast 和 Broadcast Log 指向同一页，只让 Broadcast Log 亮）。 */
  neverActive?: boolean;
}

/**
 * 还没做好 / 点进去报错 / 没内容的模块（Annie 2026-10-26）：侧栏 / My shortcuts 里对我不可见时不显示
 * （钉住的快捷方式也不显示，但不删掉，放开后自己回来）。见 `lib/page-gates.ts`。
 */
export const MODULE_VISIBILITY_KEY: Partial<Record<NavModuleId, GateKey>> = {
  farm_out_report: "farm_out_report",
  sales_report: "sales_report",
};

/** My shortcuts 里的 Tracking 小部件（三个圆标：Morning / Tour / Tickets 的 Tracking 页），Annie 2026-10-19。 */
export const TRACKING_WIDGET_ID = "tracking_widget" as const;
/** 存在 shortcuts 列表里的记号：用户删掉了 Tracking 小部件，下次读出来不要再自动补回去。只在 nav-context 里读写。 */
export const TRACKING_OFF_ID = "tracking_hidden" as const;

const MODULES: readonly NavModule[] = [
  {
    id: "dashboard",
    group: "Operations",
    label: "Dashboard",
    href: "/dashboard",
  },
  {
    // My Workspace（后端 G66，Annie 2026-10-14）：旧后台没有这一页。
    id: "workspace",
    group: "Operations",
    label: "My Workspace",
    href: "/workspace",
    dot: "#fbbf24",
  },
  {
    id: "forecast",
    group: "Operations",
    label: "7 Days Forecast",
    href: "/forecast",
  },
  {
    id: "manifests",
    group: "Operations",
    label: "Manifests",
    href: "/manifests",
  },
  { id: "orders", group: "Operations", label: "Orders", href: "/orders" },
  {
    id: "quotation",
    group: "Operations",
    label: "Quotation",
    href: "/quotation",
    upcoming: true,
  },
  {
    id: "dispatch",
    group: "Operations",
    label: "Dispatch",
    href: "/dispatch",
    exact: true,
    // Dispatch Imports 合进 Dispatch（Annie 2026-10-11），从 Step 2 的按钮进。
    match: ["/dispatch/manifest", "/dispatch/imports"],
    dot: "#22d3ee",
  },
  {
    id: "forms",
    group: "Operations",
    label: "Forms",
    href: "/forms",
    match: ["/dispatch/work-sheet", "/dispatch/guide-sheet"],
  },
  {
    id: "schedule",
    group: "Operations",
    label: "Staff Schedule",
    href: "/schedule",
    dot: "#c4b5fd",
  },
  {
    id: "daily_report",
    group: "Operations",
    label: "Daily Operation Report",
    href: "/daily-report",
    upcoming: true,
    dot: "#fbbf24",
  },
  {
    // Farm out 转单报表（Annie 2026-10-15 看预览同意，侧栏 Operations 组），旧后台没有。
    // 功能还在讨论中（Annie 2026-10-26）：仅 Super Admin 可见 + Soon 标签，见 MODULE_VISIBILITY_KEY。
    id: "farm_out_report",
    group: "Operations",
    label: "Farm out Report",
    href: "/farm-out-report",
    upcoming: true,
  },
  {
    id: "morning",
    group: "Notifications",
    label: "Morning Pickup",
    href: "/morning-pickup/send",
    match: ["/morning-pickup"],
    dot: "#3b82f6",
    noPin: true,
  },
  {
    id: "tour",
    group: "Notifications",
    label: "Tour Confirmation",
    href: "/tour-confirmation/send",
    match: ["/tour-confirmation"],
    dot: "#22c55e",
    noPin: true,
  },
  {
    id: "tickets",
    group: "Notifications",
    label: "Ticket Reminder",
    href: "/tickets-reminder/send",
    match: ["/tickets-reminder"],
    dot: "#6d5bd0",
    noPin: true,
  },
  {
    // 群发（Annie 2026-10-19）：侧栏单独一项，和 Activities 里的 Broadcast Log 是同一页，可拖、可钉。
    id: "broadcast",
    group: "Notifications",
    label: "Broadcast",
    href: "/broadcasting-log",
    dot: "#f97316",
    neverActive: true,
  },
  { id: TRACKING_WIDGET_ID, group: "Notifications", label: "Tracking", internal: true },
  { id: TRACKING_OFF_ID, group: "Notifications", label: "Tracking", internal: true },
  {
    id: "order_log",
    group: "Activities",
    label: "Order Log",
    href: "/order-log",
  },
  { id: "send_log", group: "Activities", label: "Send Log", href: "/send-log" },
  {
    id: "broadcast_log",
    group: "Activities",
    label: "Broadcast Log",
    href: "/broadcasting-log",
  },
  {
    // 功能还在讨论中（Annie 2026-10-26）：仅 Super Admin 可见 + Soon 标签，见 MODULE_VISIBILITY_KEY。
    id: "sales_report",
    group: "Reports",
    label: "Sales Report",
    href: "/sales-report",
    upcoming: true,
  },
  {
    id: "ops_summary",
    group: "Reports",
    label: "Operations Summary",
    href: "/ops-summary",
  },
  {
    id: "promotion_stats",
    group: "Reports",
    label: "Promotion Stats",
    href: "/promotion-stats",
  },
  {
    id: "bug_reports",
    group: "Reports",
    label: "Bug Reports",
    href: "/bug-reports",
  },
  {
    id: "task_board",
    group: "Reports",
    label: "Task Board",
    href: "/task-board",
  },
];

export const NAV_MODULES: Readonly<Record<NavModuleId, NavModule>> =
  Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<
    NavModuleId,
    NavModule
  >;

export function isNavModuleId(id: unknown): id is NavModuleId {
  return (
    typeof id === "string" && (NAV_MODULE_IDS as readonly string[]).includes(id)
  );
}

/** 侧栏和 Settings → Navigation 里会出现的条目（不含 Tracking 小部件这类内部条目）。 */
export const NAV_SIDEBAR_IDS: readonly NavModuleId[] = NAV_MODULE_IDS.filter(
  (id) => !NAV_MODULES[id].internal,
);

/** 能不能放进 My shortcuts（不能：Morning / Tour / Tickets，它们已经在 Tracking 小部件里）。 */
export function isPinnable(id: NavModuleId): boolean {
  return !NAV_MODULES[id].noPin;
}

/**
 * 没删过 Tracking 小部件的 shortcuts 都补上它：Dashboard 在就插在它后面，不在就放最前（Annie 2026-10-19）。
 * 用户删掉小部件时列表里会留一个记号（TRACKING_OFF_ID），有记号就不补。
 */
export function withTrackingWidget(ids: readonly NavModuleId[]): NavModuleId[] {
  if (ids.includes(TRACKING_WIDGET_ID) || ids.includes(TRACKING_OFF_ID))
    return [...ids];
  const out = [...ids];
  const i = out.indexOf("dashboard");
  out.splice(i < 0 ? 0 : i + 1, 0, TRACKING_WIDGET_ID);
  return out;
}

/** `GET /api/nav-config` / `PUT /api/admin/nav-config` 的形状（设计 §3 A1 / A2）。 */
export interface NavConfig {
  groups: {
    label: string;
    items: { id: string; label: string; visible: boolean }[];
  }[];
  default_shortcuts: string[];
}

/** 种子数据（设计 §3 A3）：后端没好 / 读不到时用它，**和后端种子数据保持完全一样**。 */
export const DEFAULT_NAV_CONFIG: NavConfig = {
  groups: ["Operations", "Notifications", "Activities", "Reports"].map(
    (label) => ({
      label,
      items: MODULES.filter((m) => m.group === label && !m.internal).map((m) => ({
        id: m.id,
        label: m.label,
        visible: true,
      })),
    }),
  ),
  // 默认七个（Annie 2026-10-24）：Dashboard、Manifests、Dispatch、7 Days Forecast、My Workspace、Work Schedule + Tracking 小部件
  // （小部件由 withTrackingWidget 补）。生产的默认值在后端 Settings → Navigation / SEED；已经存过自己列表的人不受影响。
  default_shortcuts: [
    "dashboard",
    "manifests",
    "dispatch",
    "forecast",
    "workspace",
    "schedule",
  ],
};

/** 按配置排好的侧栏：一个分组 + 里面要显示的条目（名字已换成配置里的）。 */
export interface ResolvedGroup {
  label: string;
  items: NavModule[];
}

/**
 * 配置 ⇒ 侧栏。配置里不认识的 id 丢掉；代码里新加、配置里还没有的条目放回它的种子分组末尾（照常显示），
 * 这样新页面上线不用先等 superadmin 改配置。名字空着的用代码里的默认名。
 */
export function resolveNav(config: NavConfig): ResolvedGroup[] {
  const seen = new Set<string>();
  const groups: ResolvedGroup[] = config.groups.map((g) => ({
    label: g.label,
    items: g.items.flatMap((it) => {
      if (!isNavModuleId(it.id) || NAV_MODULES[it.id].internal || seen.has(it.id))
        return [];
      seen.add(it.id);
      if (!it.visible) return [];
      const m = NAV_MODULES[it.id];
      return [{ ...m, label: it.label.trim() || m.label }];
    }),
  }));
  for (const m of MODULES) {
    if (seen.has(m.id) || m.internal) continue;
    let g = groups.find((x) => x.label === m.group);
    if (!g) {
      g = { label: m.group, items: [] };
      groups.push(g);
    }
    g.items.push(m);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** 配置里写的名字（快捷方式块上也用这个名字）。 */
export function labelsFrom(config: NavConfig): Record<NavModuleId, string> {
  const labels = Object.fromEntries(
    MODULES.map((m) => [m.id, m.label]),
  ) as Record<NavModuleId, string>;
  for (const g of config.groups) {
    for (const it of g.items) {
      if (isNavModuleId(it.id) && it.label.trim())
        labels[it.id] = it.label.trim();
    }
  }
  return labels;
}

/** Settings 组：不进配置（只 admin 看得到，照旧后台）。 */
export const NAV_SETTINGS: { label: string; items: NavItem[] } = {
  label: "Settings",
  items: [
    { label: "General", soon: true },
    { label: "Products", href: "/settings/products" },
    // 定时自动发送（后端 auto-send G76，Annie 2026-10-15 看预览同意），旧后台没有。
    // 2026-10-24 起只对 Super Admin 可见（后端 GET/PUT 对其他人 403）。
    { label: "Auto Send", href: "/settings/auto-send", superadminOnly: true },
    // 系统自己发的通知的统一开关页（Annie 2026-10-24 看过 preview 后「自动开关：动手」），admin 可看。
    { label: "Notifications", href: "/settings/notifications" },
    { label: "Content Studio", href: "/settings/content-studio" },
    { label: "Pickup Locations", href: "/settings/pickup-locations" },
    // Farm out 转单（Annie 2026-10-15 看预览同意）：合作公司 + 每家的发车时间表，旧后台没有。
    { label: "Farm out Partners", href: "/settings/farm-out-partners" },
    { label: "Farm out Timetable", href: "/settings/farm-out-timetable" },
    { label: "Vehicles", href: "/settings/vehicles" },
    { label: "Teams", href: "/settings/teams" },
    // 按人打勾的权限（Team 权限 v2，Annie 2026-10-25「动手」）：只有 Super Admin 能开。
    { label: "Team", href: "/settings/team", superadminOnly: true },
    { label: "Users", href: "/settings/users" },
    { label: "Human Resource", href: "/settings/hr", supervisorVisible: true },
    { label: "My Workspace", href: "/settings/workspace" },
    { label: "Transfer & Charter", href: "/settings/transfer-charter" },
    { label: "Navigation", href: "/settings/navigation", superadminOnly: true },
  ],
};

/** 旧后台的 Messages 页（还没迁）。在侧栏上是一级入口。 */
export const NAV_MESSAGES: NavItem = {
  label: "Messages",
  href: "/admin/messages",
  legacy: true,
};

/**
 * 这些路径开头的页面不套外框（没有侧栏和顶栏），页面自己整页布局。
 * 三个 tracking 页：旧后台的 tracking_*.html 不继承 base.html，是自己的整页深色设计（Annie 2026-10-07：和旧版一模一样）。
 * 登录走 `/auth/login`（next.config.ts 转发到后端，不经过本仓库的 React 页面），不需要这里管。
 */
export const NO_NAV_PREFIXES: readonly string[] = [
  "/morning-pickup/tracking",
  "/tickets-reminder/tracking",
  "/tour-confirmation/tracking",
  // 周三确认排班的邮件链接页（一人一条，不用登录，没有侧栏 / 顶栏）。
  "/schedule/confirm/link",
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (!item.href || item.legacy || (item as NavModule).neverActive) return false;
  if (pathname === item.href) return true;
  const prefixes = [...(item.exact ? [] : [item.href]), ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
