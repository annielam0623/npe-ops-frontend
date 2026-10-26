"use client";

import { useEffect, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { fetchDashboardWidgets } from "@/lib/daily-report-api";
import type { CurrentUser } from "@/types";

/**
 * 还没做好 / 点进去报错 / 没内容的模块（Annie 2026-10-26「我们还没有做好，或者点击了以后报错的没有内容的模块，
 * 就仅super admin可见，然后都打上soon的标签」）：从这三个开始——Sales Report、Farm out Report、
 * Dispatch 的 Farm out。key 走已有的 `/api/settings/dashboard-widgets`（同 Daily Operation Report 用的那张表），
 * 这三个默认都是 super_admin_only，不用三档（没有 admin 档的需求），所以沿用现成的两档类型，不用等三档上线。
 * 后端读不到某个 key（还没登记 / 接口出错）时按默认值 super_admin_only 自己算，不让 Super Admin 看不到。
 */
export const GATE_KEYS = [
  "sales_report",
  "farm_out_report",
  "farm_out_dispatch",
] as const;
export type GateKey = (typeof GATE_KEYS)[number];

interface Snapshot {
  loaded: boolean;
  me: CurrentUser | null;
  visible: Partial<Record<GateKey, boolean>>;
  unauthorized: boolean;
}

let snapshot: Snapshot = {
  loaded: false,
  me: null,
  visible: {},
  unauthorized: false,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

/** 整站只读一次（换页不重读）。 */
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
    const visible: Partial<Record<GateKey, boolean>> = {};
    if (widgets.status === "fulfilled") {
      for (const w of widgets.value.widgets) {
        if ((GATE_KEYS as readonly string[]).includes(w.key)) {
          visible[w.key as GateKey] = w.visible_to_me;
        }
      }
    }
    publish({
      loaded: true,
      unauthorized,
      me: me.status === "fulfilled" ? me.value : null,
      visible,
    });
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export interface PageGates {
  loaded: boolean;
  isSuperAdmin: boolean;
  /** 我看不看得到（读不到按默认值 super_admin_only 算：读完之前当不可见，免得先闪一下再藏起来）。 */
  visible: (key: GateKey) => boolean;
}

export function usePageGates(onUnauthorized?: () => void): PageGates {
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

  const isSuperAdmin = !!snap.me?.is_superadmin;
  return {
    loaded: snap.loaded,
    isSuperAdmin,
    visible: (key) => {
      const v = snap.visible[key];
      if (v != null) return v;
      return snap.loaded && isSuperAdmin;
    },
  };
}
