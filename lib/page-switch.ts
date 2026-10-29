/**
 * 分批切换（Annie 2026-10-10 定，取代 10-03 的「全部做完一次性切换」）：staff 只用 ops 一个网址、只登录一次。
 *
 * - ops 自己没有的路径一律原样转给后端（next.config.ts 的 fallback 转发）：旧后台页面、它的样式、它调的接口都在 ops 的网址下打开，
 *   带的是在 ops 登录时拿到的同一个 cookie，不用再登录一次。
 * - **切一页只改下面的 `SWITCHED`**：清单里的页面，旧路径自动跳到 ops 新页面（next.config.ts 的 redirects），侧栏也指向新页面；
 *   不在清单里的，侧栏和 dashboard 的链接指向旧路径（同一个网址下，不再跳去 confirm）。
 * - ⚠️ 改完要重新部署才生效（推 main 自动部署）。
 *
 * 这个文件也被 next.config.ts 引用，不要用 `@/` 别名、不要引 React。
 */

export interface MigratedPage {
  /** ops 新页面的路径。 */
  ops: string;
  /** 旧后台对应页面的路径（可以带查询串，例如 coming-soon 的占位页）。 */
  legacy: string;
}

/** 已经在 ops 上做好的页面 ↔ 旧后台的页面（旧路径照旧后台 base.html 的侧栏）。 */
export const MIGRATED_PAGES: readonly MigratedPage[] = [
  { ops: "/dashboard", legacy: "/admin/dashboard" },
  { ops: "/forecast", legacy: "/admin/coming-soon?module=30+Days+Forecast" },
  { ops: "/manifests", legacy: "/admin/manifests" },
  { ops: "/orders", legacy: "/admin/operations/orders" },
  { ops: "/dispatch", legacy: "/admin/dispatch/assignments" },
  { ops: "/dispatch/manifest", legacy: "/admin/dispatch/manifest" },
  { ops: "/dispatch/imports", legacy: "/admin/dispatch/imports" },
  { ops: "/dispatch/work-sheet", legacy: "/admin/dispatch/work-sheet" },
  { ops: "/dispatch/guide-sheet", legacy: "/admin/dispatch/guide-sheet" },
  {
    ops: "/morning-pickup/send",
    legacy: "/admin/notifications/morning-pickup/send",
  },
  {
    ops: "/morning-pickup/tracking",
    legacy: "/admin/notifications/morning-pickup/tracking",
  },
  {
    ops: "/tour-confirmation/send",
    legacy: "/admin/notifications/tour-confirmation/send",
  },
  {
    ops: "/tour-confirmation/tracking",
    legacy: "/admin/notifications/tour-confirmation/tracking",
  },
  {
    ops: "/tickets-reminder/send",
    legacy: "/admin/notifications/tickets-reminder/send",
  },
  {
    ops: "/tickets-reminder/tracking",
    legacy: "/admin/notifications/tickets-reminder/tracking",
  },
  { ops: "/order-log", legacy: "/admin/activities/order-log" },
  { ops: "/send-log", legacy: "/admin/notifications/send-log" },
  { ops: "/broadcasting-log", legacy: "/admin/activities/broadcasting-log" },
  { ops: "/sales-report", legacy: "/admin/system/sales-report" },
  { ops: "/ops-summary", legacy: "/admin/system/ops-summary" },
  { ops: "/promotion-stats", legacy: "/admin/system/promotion-stats" },
  { ops: "/bug-reports", legacy: "/admin/system/bug-reports" },
  { ops: "/task-board", legacy: "/admin/system/task-board" },
  { ops: "/settings/products", legacy: "/admin/settings/products" },
  { ops: "/settings/content-studio", legacy: "/admin/settings/templates" },
  {
    ops: "/settings/pickup-locations",
    legacy: "/admin/settings/pickup-locations",
  },
  { ops: "/settings/vehicles", legacy: "/admin/settings/vehicles" },
  { ops: "/settings/teams", legacy: "/admin/settings/teams" },
  // Users 并进 Team（Annie 2026-10-28「动手」）：旧后台的 Users 页跳到合并后的 Team 页。
  { ops: "/settings/team", legacy: "/admin/settings/users" },
  { ops: "/settings/hr", legacy: "/admin/settings/hr" },
];

/**
 * ⭐ 已切换的页面（写 ops 路径）。**切一页就把它的 ops 路径加进来**，其余什么都不用改。
 * 一开始是空的：上线后 staff 看到的仍全是旧页面，只是网址换成了 ops。
 * 2026-10-12 Annie 定全部切换（当时 ops 只有她一个人在用）；只留 Bug Reports 没切——这页挂起了（Annie 2026-10-11：主业务上线以后再做）。
 */
export const SWITCHED: readonly string[] = MIGRATED_PAGES.map((p) => p.ops).filter(
  (ops) => ops !== "/bug-reports",
);

/** 切换清单的几个判断，清单作参数传进来（检查脚本拿别的清单试「切换以后」的样子）。 */
export function makeSwitch(switched: readonly string[]) {
  const isSwitched = (opsPath: string) => switched.includes(opsPath);

  /**
   * 这一页在 ops 里打开（站内跳转）：已切换，或者旧后台根本没有这一页（dashboard 改版新加的 /forms、/quotation 等，
   * 不在对照表里，没有旧页面可去）。只拿 ops 路径来问。
   */
  const opensInOps = (opsPath: string) =>
    isSwitched(opsPath) || !MIGRATED_PAGES.some((p) => p.ops === opsPath);

  /**
   * 侧栏 / dashboard 链接该去哪：这一页已切换 ⇒ ops 新页面；还没切 ⇒ 旧后台的路径（同一个网址下）。
   * 不在对照表里的路径原样返回。
   */
  const pageHref = (opsPath: string): string => {
    if (isSwitched(opsPath)) return opsPath;
    return MIGRATED_PAGES.find((p) => p.ops === opsPath)?.legacy ?? opsPath;
  };

  /**
   * 旧后台路径（可带查询串，例如 dashboard 消息卡片的 `track_url`）⇒ 该去的地方：
   * 对应的 ops 页面已切换就换成 ops 路径（保留查询串），否则原样（同一个网址下的旧页面）。
   */
  const fromLegacy = (legacyUrl: string): string => {
    const [path, query] = legacyUrl.split("?", 2);
    const page = MIGRATED_PAGES.find(
      (p) => p.legacy === path && isSwitched(p.ops),
    );
    if (!page) return legacyUrl;
    return query ? `${page.ops}?${query}` : page.ops;
  };

  /**
   * next.config.ts 的 redirects：首页按 Dashboard 有没有切换进新 / 旧 dashboard；已切换的页面，旧路径跳到新页面
   * （查询串 Next 自动带上）。带查询串的旧路径（coming-soon?module=…）要查询串也对上才跳，不能把别的占位页一起跳走。
   * 全部 307（非永久）：以后清单变了，浏览器不会记住旧的跳转。
   */
  const redirects = () => [
    { source: "/", destination: pageHref("/dashboard"), permanent: false },
    ...MIGRATED_PAGES.filter((p) => isSwitched(p.ops)).map((p) => {
      const [path, query] = p.legacy.split("?", 2);
      const has = query
        ? [...new URLSearchParams(query)].map(([key, value]) => ({
            type: "query" as const,
            key,
            value,
          }))
        : undefined;
      return { source: path, destination: p.ops, permanent: false, has };
    }),
  ];

  return { isSwitched, opensInOps, pageHref, fromLegacy, redirects };
}

export const { isSwitched, opensInOps, pageHref, fromLegacy, redirects } =
  makeSwitch(SWITCHED);
