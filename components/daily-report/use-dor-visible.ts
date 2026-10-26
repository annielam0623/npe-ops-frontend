"use client";

import { usePageVisibility } from "@/lib/page-visibility";

export type DorVisibility = "loading" | "visible" | "hidden";

/**
 * Daily Operation Report 板块对我可见吗：整站共用的「谁看得到」数据（lib/page-visibility.ts，key daily_operation_report）。
 * 后端读不到时按默认值（super_admin_only）算：Super Admin 看得到，其他人看不到。
 * 不可见时调用方不要去请求 DOR 接口（非 Super Admin 开关关着时会 403）。
 * staffSees = 现在是不是 Everyone（Super Admin 那边画不画虚线框）。
 */
export function useDorVisible(onUnauthorized: () => void) {
  const vis = usePageVisibility(onUnauthorized);
  const state: DorVisibility = !vis.loaded
    ? "loading"
    : vis.visible("daily_operation_report")
      ? "visible"
      : "hidden";
  return {
    state,
    staffSees: vis.visibilityOf("daily_operation_report") === "staff",
  };
}
