/**
 * 顶栏左边的页面名，照旧后台各模板的 `{% block page_title %}`（Annie 2026-10-07：和旧版一模一样）。
 * 旧模板没写 page_title 的（dashboard、Teams、Users）顶栏是空的，这里也不写。
 * 按路径前缀找，长的先认（/dispatch/work-sheet 不会被 /dispatch 抢走）。
 */
const PAGE_TITLES: readonly [prefix: string, title: string][] = [
  ["/manifests", "Manifests"],
  ["/orders", "Orders"],
  ["/dispatch/imports", "Dispatch Imports"],
  ["/dispatch/work-sheet", "Dispatch — Work Sheet"],
  ["/dispatch/guide-sheet", "Dispatch — Guide Sheet"],
  ["/dispatch/manifest", "Dispatch — Tour manifest"],
  ["/dispatch", "Dispatch — Assignments"],
  ["/morning-pickup/send", "Morning Pickup — Send"],
  ["/tour-confirmation/send", "Tour Confirmation — Send"],
  ["/tickets-reminder/send", "Tickets Reminder — Send"],
  ["/order-log", "Order Log"],
  ["/send-log", "Send Log"],
  ["/broadcasting-log", "Broadcasting Log"],
  ["/sales-report", "Sales Report"],
  ["/ops-summary", "Operations Summary"],
  ["/promotion-stats", "Promotion Stats — MTLV"],
  ["/bug-reports", "Bug Reports"],
  ["/task-board", "Task Board"],
  ["/settings/products", "Products"],
  ["/settings/content-studio", "Content Studio"],
  ["/settings/pickup-locations", "Pickup Locations"],
  ["/settings/vehicles", "Vehicles"],
  ["/settings/hr", "Human Resource"],
];

const BY_LENGTH = [...PAGE_TITLES].sort((a, b) => b[0].length - a[0].length);

export function pageTitleFor(pathname: string): string {
  // 订单详情：旧模板是 Order Detail。
  if (/^\/orders\/[^/]+/.test(pathname)) return "Order Detail";
  const hit = BY_LENGTH.find(
    ([p]) => pathname === p || pathname.startsWith(`${p}/`),
  );
  return hit ? hit[1] : "";
}

/** 旧后台三个发送页把顶栏的搜索框藏起来了（模板里 topbar_actions 的 .top-search{display:none}）。 */
const NO_SEARCH_PREFIXES = [
  "/morning-pickup/send",
  "/tour-confirmation/send",
  "/tickets-reminder/send",
];

export function showTopSearch(pathname: string): boolean {
  return !NO_SEARCH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
