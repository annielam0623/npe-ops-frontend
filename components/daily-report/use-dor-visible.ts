"use client";

import { useEffect, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { DOR_WIDGET_ID, fetchDashboardWidgets } from "@/lib/daily-report-api";

export type DorVisibility = "loading" | "visible" | "hidden";

/**
 * Daily Operation Report 板块对我可见吗：只信后端 /api/settings/dashboard-widgets 的 visible_to_me。
 * 读不到（404 接口没上线 / 403 / 其他错误 / 板块没登记）一律当不可见，宁可不画；
 * 不可见时调用方不要去请求 DOR 接口（非 Super Admin 开关关着时会 403）。
 */
export function useDorVisible(onUnauthorized: () => void): DorVisibility {
  const [state, setState] = useState<DorVisibility>("loading");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchDashboardWidgets(controller.signal);
        if (controller.signal.aborted) return;
        const widget = data.widgets.find((w) => w.id === DOR_WIDGET_ID);
        setState(widget?.visible_to_me ? "visible" : "hidden");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        setState("hidden");
      }
    })();
    return () => controller.abort();
  }, [onUnauthorized]);

  return state;
}
