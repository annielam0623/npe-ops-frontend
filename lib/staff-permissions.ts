"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api-client";
import { usePageVisibility } from "@/lib/page-visibility";

/**
 * 员工权限（Team 权限 v2 第三步，Annie 2026-10-26 对 preview 第 2 版
 * https://claude.ai/artifact/AmaVXWDo7joP2RfRPfhAQr 说「动手」，Q1–Q8 按建议）。
 *
 * - 数据：后端 `GET /api/me/permissions` → 我在 Settings › Team 被勾了哪些项（Super Admin 返回全部）。
 * - 总开关：`/api/settings/dashboard-widgets` 的 `staff_permissions`（默认 super_admin_only = 实际关，
 *   Super Admin 本来就看全部）。对我 visible_to_me=true 才按勾藏；关着、读不到、权限接口出错都照旧（不藏）。
 * - 一律按勾藏，不看 `wired`（Q4 A）：批次之间入口不会忽隐忽现。
 * - 外部账号（`/api/me` 的 role = "partner"，例如 CCL，Annie 2026-10-26 选方案 B）：不管总开关，一律按勾；
 *   权限读不到就什么都不给看。
 * - partner 首页（Annie 2026-10-27「动手」，preview https://claude.ai/artifact/A3ia5c3Lw9aQv7Fo9UYTJC）：
 *   首页固定是 /dashboard 上的 partner 版（整张 7 Days Forecast），不看 dashboard.view、不看 Team 页设的首页（Q5 A、Q7 A）；
 *   只能看（「合作方只能看manifest和订单，不能改或者选任何功能」）：除了 .view 以外的项一律当没勾；
 *   Farm out Report 不给（「关」）。
 * - `messages.*` 后端这次不接（含义没定，后端 17 2026-10-26），前端不按它们藏任何东西。
 * - partner 只能开表里有、勾了的页面：不在表里的路径（旧后台链接、Notifications 之类）一律不给，
 *   它们请求的接口后端对 partner 都是 403（后端 8a 2026-10-26）。
 */

interface MyPermissionsResponse {
  is_superadmin: boolean;
  permissions: { code: string; module: string; wired: boolean }[];
  default_home: string | null;
}

export function fetchMyPermissions(
  signal?: AbortSignal,
): Promise<MyPermissionsResponse> {
  return apiFetch<MyPermissionsResponse>("/api/me/permissions", {
    cache: "no-store",
    signal,
  });
}

/**
 * 每个页面要哪一项（任一项有就能打开）。按前缀匹配，最长的前缀优先；`null` = 谁都能开（不拦）。
 * 不在表里的路径：员工不拦，partner 不给。对照 preview 第 7 节。
 */
const ROUTE_PERMISSIONS: readonly (readonly [
  string,
  readonly string[] | null,
])[] = [
  ["/dashboard", ["dashboard.view"]],
  ["/forecast", ["forecast.view"]],
  ["/manifests", ["manifests.view"]],
  ["/orders", ["orders.view"]],
  ["/dispatch", ["dispatch.view"]],
  ["/forms", ["forms.view"]],
  ["/schedule", ["schedule.view"]],
  // 周三确认排班的邮件链接页：不用登录，不拦。
  ["/schedule/confirm/link", null],
  ["/daily-report", ["report.view"]],
  ["/morning-pickup", ["morning.view"]],
  ["/tour-confirmation", ["tour.view"]],
  ["/tickets-reminder", ["tickets.view"]],
  // 后端：logs.view / tour.view / tickets.view 任一项。
  ["/broadcasting-log", ["logs.view", "tour.view", "tickets.view"]],
  ["/order-log", ["logs.view"]],
  ["/send-log", ["logs.view"]],
  ["/sales-report", ["reports.view"]],
  ["/ops-summary", ["reports.view"]],
  ["/promotion-stats", ["reports.view"]],
  // Q7 A：Farm out Report 跟 reports.view（开关 farm_out_report 照旧，两道都要过）。
  ["/farm-out-report", ["reports.view"]],
  ["/workspace", ["workspace.use"]],
  ["/quotation", ["quotation.create"]],
  ["/task-board", ["taskboard.use"]],
  ["/bug-reports", ["bugs.use"]],
  ["/settings/content-studio", ["settings.content"]],
  ["/settings/pickup-locations", ["settings.pickup"]],
  ["/settings/products", ["settings.products"]],
  ["/settings/farm-out-partners", ["settings.farm_out"]],
  ["/settings/farm-out-timetable", ["settings.farm_out"]],
  ["/settings/vehicles", ["settings.vehicles"]],
  ["/settings/auto-send", ["settings.auto_send"]],
  ["/settings/users", ["settings.users"]],
  ["/settings/teams", ["settings.users"]],
  ["/settings/hr", ["settings.hr.view"]],
  ["/settings/transfer-charter", ["quotation.rates_edit"]],
  // Q8 A：新项 settings.workspace 要等后端迁移；没加之前谁都没有这一项 ⇒ 只有 Super Admin 能开。
  ["/settings/workspace", ["settings.workspace"]],
];

/** 打开这个路径要哪些项（任一）；null = 谁都不拦；undefined = 不在表里（员工不拦，partner 不给）。 */
export function requiredForPath(
  path: string,
): readonly string[] | null | undefined {
  const pathname = path.split(/[?#]/)[0];
  let best: (typeof ROUTE_PERMISSIONS)[number] | null = null;
  for (const entry of ROUTE_PERMISSIONS) {
    const [prefix] = entry;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best[0].length) best = entry;
    }
  }
  return best ? best[1] : undefined;
}

/**
 * partner 永远不给的对外发送（Annie 2026-10-27，后端 17 转，原话「发送只能是我们内部员工发送」，只管对外的这 7 项，同后端 d7）。
 * reports.send_daily 不算：那是手动补发晚上那份内部 Excel，收件人都是内部。
 * Team 页以 catalog 的 staff_only 为准，catalog 没带时也用这张表（components/team-permissions/access.ts）。
 */
const PARTNER_NEVER = new Set([
  "dispatch.send",
  "manifests.send",
  "tour.send",
  "morning.send",
  "tickets.send",
  "broadcast.send",
  "messages.reply",
]);

export function isSendCode(code: string): boolean {
  return PARTNER_NEVER.has(code);
}

/** 整页只为发送的页面：partner 一律打不开（侧栏 / shortcut 也不出），不看勾。 */
const PARTNER_SEND_PAGES = [
  "/tour-confirmation/send",
  "/morning-pickup/send",
  "/tickets-reminder/send",
];

/** partner 怎么勾都打不开的页面：整页只为发送的、Farm out Report（Annie 2026-10-27「关」）。 */
const PARTNER_CLOSED_PAGES = [...PARTNER_SEND_PAGES, "/farm-out-report"];

function isPartnerClosedPage(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return PARTNER_CLOSED_PAGES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

interface PermSnapshot {
  loaded: boolean;
  /** 读成功了；失败 = 照旧（不藏）。 */
  ok: boolean;
  isSuperAdmin: boolean;
  codes: ReadonlySet<string>;
  defaultHome: string | null;
}

let snapshot: PermSnapshot = {
  loaded: false,
  ok: false,
  isSuperAdmin: false,
  codes: new Set(),
  defaultHome: null,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** 整站只读一次（换页不重读），同 page-visibility。 */
function ensureLoaded(): Promise<void> {
  if (snapshot.loaded) return Promise.resolve();
  if (inflight) return inflight;
  inflight = fetchMyPermissions()
    .then(
      (r): PermSnapshot => ({
        loaded: true,
        ok: true,
        isSuperAdmin: !!r.is_superadmin,
        codes: new Set(r.permissions.map((p) => p.code)),
        defaultHome: r.default_home || null,
      }),
      (): PermSnapshot => ({ ...snapshot, loaded: true, ok: false }),
    )
    .then((next) => {
      snapshot = next;
      for (const l of listeners) l();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export interface Permissions {
  /** 结果定了：总开关读完；对我开着的话，权限也读完。没定之前页面先不画（不请求它的接口）。 */
  ready: boolean;
  /** 正在按勾藏（总开关对我开着、权限读到了、我不是 Super Admin）。 */
  active: boolean;
  /** 有这一项吗（没在按勾藏时一律 true）。 */
  can: (code: string) => boolean;
  /** 任一项有就行。 */
  canAny: (codes: readonly string[]) => boolean;
  /** 能打开这个路径吗（按 ROUTE_PERMISSIONS）。 */
  canOpen: (path: string) => boolean;
  /** Settings › Team 里给这个人设的首页（没有 dashboard.view 的人登录后去这里）。 */
  defaultHome: string | null;
  /** 外部账号（partner）。 */
  isPartner: boolean;
  /** 用 partner 的版面：partner、而且不是 Super Admin（没有侧栏，顶栏只有 Home + 勾了的页，首页是整张 Forecast）。 */
  partnerView: boolean;
  /**
   * 我是 partner、没被勾这一项（方案 B：partner 一律按勾显示按钮）。读失败 / 没读完也算没勾。
   * partner 只能看（Annie 2026-10-27）：不是 .view 的项（.edit / .export / 发送……）永远 true，勾了也不给。
   * 员工、Super Admin 一律 false（员工的按钮级权限以后另做）。
   */
  partnerLacks: (code: string) => boolean;
  /**
   * 客人对话（后端 d7 53a1a39d）：messages.view = 看对话（Dashboard Messages、tracking 页对话格 / 弹窗），
   * messages.reply = 写（回复、内部备注、指派、Take action）。partner 按勾（reply 永远没有，见 isSendCode）；
   * 员工等 STAFF_MESSAGES_BY_TICK 打开才按勾，之前一律 true。
   */
  canMessages: (code: "messages.view" | "messages.reply") => boolean;
  /**
   * tracking 页单行的 Take action / Mark as actioned（PUT /api/bookings/{id}/take-action，后端 d7 2026-10-27）：
   * 门票页看 tickets.send，Tour / 早班看 tour.send 或 morning.send；partner 永远没有。
   * Dashboard 的 Multi Orders Take action（/booking-notes/multi/take-action）不走这里，照旧按 messages.reply。
   */
  canRowTakeAction: (page: "tickets" | "tour" | "morning") => boolean;
}

/** partner 的首页：/dashboard 上的 partner 版（Q1 A），不读后端给的 default_home（Q7 A）。 */
const PARTNER_HOME = "/dashboard";

/**
 * 员工的客人对话也按 messages.view / reply 的勾（主窗口 ad 2026-10-27：先确认 37 个员工都勾了再开）。
 * true = 员工也按勾（staff_permissions 总开关对他开着时；关着照旧全给）。false = 员工照旧，只有 partner 按勾。
 */
const STAFF_MESSAGES_BY_TICK = true;

export function usePermissions(): Permissions {
  const vis = usePageVisibility();
  const isPartner = vis.me?.role === "partner";
  const switchOn =
    vis.loaded &&
    !vis.isSuperAdmin &&
    (isPartner || vis.visible("staff_permissions"));
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    if (!switchOn) return;
    const listener = () => setSnap(snapshot);
    listeners.add(listener);
    void ensureLoaded().then(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [switchOn]);

  const ready = vis.loaded && (!switchOn || snap.loaded);
  // 读失败：员工照旧（不藏）；partner 什么都不给看（codes 是空的）。
  const active =
    switchOn && snap.loaded && (snap.ok ? !snap.isSuperAdmin : isPartner);
  const can = (code: string) => !active || snap.codes.has(code);
  const canAny = (codes: readonly string[]) => codes.some(can);
  const partnerView = isPartner && !vis.isSuperAdmin;
  const partnerLacks = (code: string) =>
    partnerView &&
    (isSendCode(code) ||
      !code.endsWith(".view") ||
      !(active && snap.codes.has(code)));
  return {
    ready,
    active,
    can,
    canAny,
    canOpen: (path) => {
      if (partnerView && isPartnerClosedPage(path)) return false;
      const need = requiredForPath(path);
      // partner 首页不看 dashboard.view（Q5 A）。
      if (partnerView && need?.includes("dashboard.view")) return true;
      if (need === null) return true;
      if (need === undefined) return !(active && isPartner);
      return canAny(need);
    },
    defaultHome: partnerView ? PARTNER_HOME : active ? snap.defaultHome : null,
    isPartner,
    partnerView,
    partnerLacks,
    canMessages: (code) =>
      isPartner ? !partnerLacks(code) : !STAFF_MESSAGES_BY_TICK || can(code),
    canRowTakeAction: (page) =>
      !isPartner &&
      (page === "tickets"
        ? can("tickets.send")
        : canAny(["tour.send", "morning.send"])),
  };
}
