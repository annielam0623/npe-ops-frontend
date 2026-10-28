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
 *   权限读不到就什么都不给看；没有 default_home 就去 /forecast。
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
 * partner 暂不放的动作（后端 8a 2026-10-26：勾了也 403）：页面上对 partner 藏掉这些按钮 / 入口，
 * 也不发它们的请求。后端接线了删一行就行。员工不受影响（员工的按钮级权限以后另做）。
 * manifests.edit / manifests.send 已删（后端 G177 P2 bb3b7d84 按勾放行）：partner 勾了才出，见 partnerLacks。
 * 下面 dispatch 两行：等后端 17 跟 Annie 确认 partner 能不能排车、发通知以后再删。
 */
const PARTNER_HELD = [
  // Dispatch：排车（选人选车、保存、Copy、Pull from Discord、CCL 预填、配 Private 订单、挪座位、Completed、Farm out）。
  "dispatch.edit",
  // Dispatch ② Send（发司机、Morning Relay）。
  "dispatch.send",
] as const;

export type PartnerHeldAction = (typeof PARTNER_HELD)[number];

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
  /** 这个动作对我藏着（partner 今晚不放，见 PARTNER_HELD）。员工一律 false。 */
  held: (action: PartnerHeldAction) => boolean;
  /**
   * 我是 partner、没被勾这一项（方案 B：partner 一律按勾显示按钮）。读失败 / 没读完也算没勾。
   * 员工、Super Admin 一律 false（员工的按钮级权限以后另做）。
   */
  partnerLacks: (code: string) => boolean;
}

/** 外部账号（partner）没有 default_home 时的首页。 */
const PARTNER_HOME = "/forecast";

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
  return {
    ready,
    active,
    can,
    canAny,
    canOpen: (path) => {
      const need = requiredForPath(path);
      if (need === null) return true;
      if (need === undefined) return !(active && isPartner);
      return canAny(need);
    },
    defaultHome: active
      ? snap.defaultHome || (isPartner ? PARTNER_HOME : null)
      : null,
    isPartner,
    // 还没读完时也当藏着（partner 的页面要等 ready 才画，这里只是保险）。
    held: (action) =>
      isPartner &&
      !vis.isSuperAdmin &&
      (PARTNER_HELD as readonly string[]).includes(action),
    partnerLacks: (code) =>
      isPartner && !vis.isSuperAdmin && !(active && snap.codes.has(code)),
  };
}
