/**
 * 侧栏导航，结构照旧后台 base.html 的侧栏（分组、顺序、名字）。
 * 已迁到 ops 的页面用站内路径；还没迁 / 不迁的页面链回旧后台（legacy: true），迁过来以后改成站内路径。
 * 旧后台里的占位页（30 Days Forecast、General）显示成 Coming soon、不可点。
 */
export interface NavItem {
  label: string;
  href?: string;
  /** 链回旧后台（href 是旧后台路径）。 */
  legacy?: boolean;
  /** 这些路径开头的页面也算这一项（例：tracking 页算在 Send 那一项下）。 */
  match?: string[];
  soon?: boolean;
  /** 只认 href 本身（不认 href/... 下面的页面）：/dispatch 不能把 /dispatch/work-sheet 也算进来。 */
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  /** 只有 admin 及以上看得到（同旧后台的 Settings）。 */
  adminOnly?: boolean;
  items: NavItem[];
}

export const NAV_TOP: NavItem = { label: "Dashboard", href: "/dashboard" };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { label: "30 Days Forecast", soon: true },
      { label: "Manifests", href: "/manifests" },
      { label: "Orders", href: "/orders" },
      {
        label: "Dispatch",
        href: "/dispatch",
        exact: true,
        match: ["/dispatch/manifest"],
      },
      { label: "Dispatch Imports", href: "/dispatch/imports" },
      { label: "Work Sheet", href: "/dispatch/work-sheet" },
      { label: "Guide Sheet", href: "/dispatch/guide-sheet" },
    ],
  },
  {
    label: "Notifications",
    items: [
      {
        label: "Morning Pickup",
        href: "/morning-pickup/send",
        match: ["/morning-pickup"],
      },
      {
        label: "Tour Confirmation",
        href: "/tour-confirmation/send",
        match: ["/tour-confirmation"],
      },
      {
        label: "Ticket Reminder",
        href: "/tickets-reminder/send",
        match: ["/tickets-reminder"],
      },
    ],
  },
  {
    label: "Activities",
    items: [
      { label: "Order Log", href: "/order-log" },
      { label: "Send Log", href: "/send-log" },
      { label: "Broadcast Log", href: "/broadcasting-log" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Sales Report", href: "/sales-report" },
      { label: "Operations Summary", href: "/ops-summary" },
      { label: "Promotion Stats", href: "/promotion-stats" },
      { label: "Bug Reports", href: "/bug-reports" },
      { label: "Task Board", href: "/task-board" },
    ],
  },
  {
    label: "Settings",
    adminOnly: true,
    items: [
      { label: "General", soon: true },
      { label: "Products", href: "/settings/products" },
      { label: "Content Studio", href: "/settings/content-studio" },
      { label: "Pickup Locations", href: "/settings/pickup-locations" },
      { label: "Vehicles", href: "/settings/vehicles" },
      { label: "Teams", href: "/settings/teams" },
      { label: "Users", href: "/settings/users" },
      { label: "Human Resource", href: "/settings/hr" },
    ],
  },
];

/** 旧后台的 Messages 页（还没迁）。在侧栏上是一级入口。 */
export const NAV_MESSAGES: NavItem = {
  label: "Messages",
  href: "/admin/messages",
  legacy: true,
};

/** 这些页面不显示侧栏（登录占位页；纸本单子打印时由各自的样式隐藏）。 */
export const NO_NAV_PREFIXES = ["/login"];

export function isActive(item: NavItem, pathname: string): boolean {
  if (!item.href || item.legacy) return false;
  if (pathname === item.href) return true;
  const prefixes = [...(item.exact ? [] : [item.href]), ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
