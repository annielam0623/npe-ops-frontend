"use client";

import { useEffect, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  fetchDashboardWidgets,
  updateDashboardWidgets,
} from "@/lib/daily-report-api";
import type { CurrentUser, DashboardWidgetVisibility } from "@/types";

/**
 * 新板块 / 新页面对谁可见（Annie 2026-10-25：「从 my task 开始的所有新板块都要有这个开关，只有 super admin 可以控制」）。
 * 数据是后端 `/api/settings/dashboard-widgets`（每个 key 一条：visibility / default / visible_to_me），
 * 三档：staff = 所有人；admin = admin 和 Super Admin；super_admin_only = 只有 Super Admin。只有 Super Admin 能改。
 *
 * 后端读不到某个 key（还没登记 / 接口出错）时，按下面的默认值自己算——默认值和后端登记的一致，
 * 所以不会因为后端慢一步就把员工在用的东西藏掉，也不会让 Super Admin 看不到。
 */
export type Visibility = DashboardWidgetVisibility;

export interface VisibilityKeyInfo {
  /** 给人看的名字（Page visibility 列表、开关旁边的说明）。 */
  label: string;
  /** 在哪（Page visibility 列表里写）。 */
  where: string;
  default: Visibility;
}

/** 所有受控的 key。顺序 = Settings → Notifications 里 Page visibility 列表的顺序。 */
export const VISIBILITY_KEYS = {
  // 页面 / 页面里的模块（Annie 经后端 69 定的 7 个，2026-10-25）
  schedule_page: {
    label: "Staff Schedule",
    where: "/schedule (Rules, Auto-fill, time off)",
    default: "staff",
  },
  schedule_confirm_page: {
    label: "Confirm your schedule",
    where: "/schedule/confirm and the Responses card",
    default: "staff",
  },
  dashboard_week_schedule: {
    label: "Dashboard · full-week schedule",
    where: "Bottom of the Dashboard",
    default: "staff",
  },
  farm_out_report: {
    label: "Farm out Report",
    where: "/farm-out-report",
    default: "super_admin_only",
  },
  farm_out_settings: {
    label: "Farm out Partners & Timetable",
    where: "Settings → Farm out Partners / Farm out Timetable",
    default: "super_admin_only",
  },
  content_studio_shuttle: {
    label: "Content Studio · Shuttle",
    where: "Settings → Content Studio → Shuttle",
    default: "admin",
  },
  product_categories: {
    label: "Products · Categories",
    where: "Settings → Products → Categories card",
    default: "admin",
  },
  // 已上线、功能还在讨论中（Annie 2026-10-25「sales report，farm out要加开关，这些虽然上线了但是功能还在讨论中」）
  sales_report: {
    label: "Sales Report",
    where: "/sales-report",
    default: "super_admin_only",
  },
  farm_out_dispatch: {
    label: "Dispatch · Farm out",
    where: "Dispatch → Farm out button and Send farm out notice",
    default: "super_admin_only",
  },
  // 还没做好（Annie 2026-10-26「我们还没有做好……就仅super admin可见，然后都打上soon的标签」）
  quotation: {
    label: "Quotation",
    where: "/quotation",
    default: "super_admin_only",
  },
  // Dashboard 上的块（2026-10-24 / 10-25）
  dashboard_notice: {
    label: "Dashboard · Notice",
    where: "Dashboard",
    default: "staff",
  },
  dashboard_tasks: {
    label: "Dashboard · My tasks / Today's tasks",
    where: "Dashboard",
    default: "staff",
  },
  dashboard_stats: {
    label: "Dashboard · stats row",
    where: "Dashboard",
    default: "super_admin_only",
  },
  dashboard_today_team: {
    label: "Dashboard · Today's team",
    where: "Dashboard",
    default: "super_admin_only",
  },
  dashboard_reply: {
    label: "Dashboard · Reply pop-up in Messages",
    where: "Dashboard",
    default: "super_admin_only",
  },
  daily_operation_report: {
    label: "Daily Operation Report",
    where: "Dashboard block and /daily-report",
    default: "super_admin_only",
  },
  // 员工权限总开关（Annie 2026-10-26 preview Q5 A，默认关）：对谁开着，谁就只看到 Settings › Team 里勾了的。见 lib/permissions.ts。
  staff_permissions: {
    label: "Staff permissions (Team page ticks)",
    where: "Whole site: sidebar, pages, Dashboard blocks",
    default: "super_admin_only",
  },
} as const satisfies Record<string, VisibilityKeyInfo>;

export type VisibilityKey = keyof typeof VISIBILITY_KEYS;

/** 这一档谁看得到（控件下面那行说明）。 */
export const VISIBILITY_HINT: Record<Visibility, string> = {
  staff: "Everyone can see this: staff, supervisors and admins.",
  admin:
    "Only admins and Super Admin can see this. Supervisors and staff can't.",
  super_admin_only: "Only Super Admin can see this.",
};

/** 读不到后端时，按默认值和我的角色算我看不看得到。 */
export function visibleByRule(v: Visibility, me: CurrentUser | null): boolean {
  if (v === "staff") return true;
  if (!me) return false;
  if (v === "admin") return !!(me.is_admin || me.is_superadmin);
  return !!me.is_superadmin;
}

interface Entry {
  visibility: Visibility;
  visibleToMe: boolean;
}

interface Snapshot {
  /** 两个请求都回来了（成功或失败）。 */
  loaded: boolean;
  me: CurrentUser | null;
  /** 后端登记了的 key；没登记的按默认值算。 */
  entries: Partial<Record<string, Entry>>;
  /** 读的时候 401：每个调用者（不只是先发请求的那个）都要跳登录页。 */
  unauthorized: boolean;
}

let snapshot: Snapshot = {
  loaded: false,
  me: null,
  entries: {},
  unauthorized: false,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function entriesFrom(
  widgets: { key: string; visibility: string; visible_to_me: boolean }[],
): Snapshot["entries"] {
  const out: Snapshot["entries"] = {};
  for (const w of widgets) {
    const v = w.visibility;
    if (v !== "staff" && v !== "admin" && v !== "super_admin_only") continue;
    out[w.key] = { visibility: v, visibleToMe: !!w.visible_to_me };
  }
  return out;
}

/** 整站只读一次（换页不重读）；Super Admin 改了以后用接口返回的新值更新。 */
function ensureLoaded(): Promise<void> {
  if (snapshot.loaded) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    const [me, widgets] = await Promise.allSettled([
      fetchCurrentUser(),
      fetchDashboardWidgets(),
    ]);
    const unauthorized = [me, widgets].some(
      (r) => r.status === "rejected" && isStatus(r.reason, 401),
    );
    publish({
      loaded: true,
      unauthorized,
      me: me.status === "fulfilled" ? me.value : null,
      entries:
        widgets.status === "fulfilled"
          ? entriesFrom(widgets.value.widgets)
          : {},
    });
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export interface PageVisibility {
  loaded: boolean;
  me: CurrentUser | null;
  isSuperAdmin: boolean;
  /** 我看不看得到（后端的 visible_to_me；读不到按默认值）。还没读完：默认 staff 的当看得到，其余当看不到。 */
  visible: (key: VisibilityKey) => boolean;
  /** 现在设成哪一档（读不到 = 默认值）。 */
  visibilityOf: (key: VisibilityKey) => Visibility;
  /** Super Admin 改档：PUT 后以接口返回的为准；失败抛出后端原话。 */
  setVisibility: (key: VisibilityKey, v: Visibility) => Promise<void>;
}

export function usePageVisibility(onUnauthorized?: () => void): PageVisibility {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    const listener = () => setSnap(snapshot);
    listeners.add(listener);
    void ensureLoaded().then(() => {
      listener();
      if (snapshot.unauthorized) onUnauthorized?.();
    });
    return () => {
      listeners.delete(listener);
    };
  }, [onUnauthorized]);

  const visibilityOf = (key: VisibilityKey): Visibility =>
    snap.entries[key]?.visibility ?? VISIBILITY_KEYS[key].default;

  return {
    loaded: snap.loaded,
    me: snap.me,
    isSuperAdmin: !!snap.me?.is_superadmin,
    visible: (key) => {
      const e = snap.entries[key];
      if (e) return e.visibleToMe;
      const def = VISIBILITY_KEYS[key].default;
      return snap.loaded ? visibleByRule(def, snap.me) : def === "staff";
    },
    visibilityOf,
    setVisibility: async (key, v) => {
      const result = await updateDashboardWidgets({ [key]: v });
      publish({
        ...snapshot,
        entries: { ...snapshot.entries, ...entriesFrom(result.widgets) },
      });
    },
  };
}
