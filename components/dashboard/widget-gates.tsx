"use client";

import type { ReactNode } from "react";

import { VisibilityControl } from "@/components/ui/visibility-control";
import { usePageVisibility, type VisibilityKey } from "@/lib/page-visibility";

/**
 * Dashboard 上受「谁看得到」开关管的块（数据和默认值都在 lib/page-visibility.ts，整站共用一份）：
 * - 统计行 / Today's team / Reply 弹框：新板块，默认只 Super Admin（Annie 2026-10-25「给新的板块都要设置开关」）；
 * - Notice / 任务块：员工一直在用，默认所有人（「把task和notice都加上开关」）；
 * - 底部整周排班：默认所有人（Annie 经后端 69 定，2026-10-25）。
 * 后端读不到某个 key 时按默认值算，所以 Notice / 任务块 / 整周排班不会被默默藏掉，Super Admin 也一直看得到新块。
 */
export const WIDGET_STATS = "dashboard_stats";
export const WIDGET_TODAY_TEAM = "dashboard_today_team";
export const WIDGET_REPLY = "dashboard_reply";
export const WIDGET_NOTICE = "dashboard_notice";
export const WIDGET_TASKS = "dashboard_tasks";
export const WIDGET_WEEK_SCHEDULE = "dashboard_week_schedule";

export type GateKey =
  | typeof WIDGET_STATS
  | typeof WIDGET_TODAY_TEAM
  | typeof WIDGET_REPLY
  | typeof WIDGET_NOTICE
  | typeof WIDGET_TASKS
  | typeof WIDGET_WEEK_SCHEDULE;

/** 传给板块自己画的部分：Super Admin 的控件（其他人 null）+ 员工看不到时画黄色虚线框。 */
export interface BlockGate {
  staffSwitch: ReactNode;
  hiddenFromStaff: boolean;
}

export interface WidgetGate {
  /** 对我可见 / 可用吗。 */
  visible: boolean;
  /** 员工（所有人）看得到吗：不是的话 Super Admin 那边画虚线框。 */
  staffSees: boolean;
}

export type WidgetGates = Record<GateKey, WidgetGate> & { loaded: boolean };

export function useWidgetGates(
  _isSuperAdmin: boolean,
  onUnauthorized: () => void,
): WidgetGates {
  const vis = usePageVisibility(onUnauthorized);
  const gate = (k: VisibilityKey): WidgetGate => ({
    visible: vis.visible(k),
    staffSees: vis.visibilityOf(k) === "staff",
  });
  return {
    loaded: vis.loaded,
    [WIDGET_STATS]: gate(WIDGET_STATS),
    [WIDGET_TODAY_TEAM]: gate(WIDGET_TODAY_TEAM),
    [WIDGET_REPLY]: gate(WIDGET_REPLY),
    [WIDGET_NOTICE]: gate(WIDGET_NOTICE),
    [WIDGET_TASKS]: gate(WIDGET_TASKS),
    [WIDGET_WEEK_SCHEDULE]: gate(WIDGET_WEEK_SCHEDULE),
  };
}

/**
 * 块标题行右侧的「Visible to: Everyone / Admins / Super Admin only」（只有 Super Admin 看得到）。
 * what：功能（不是整块）时写在前面，例如「Reply pop-up」。
 */
export function WidgetStaffSwitch({
  widgetKey,
  onUnauthorized,
  what,
}: {
  widgetKey: GateKey;
  gates?: WidgetGates;
  onUnauthorized: () => void;
  what?: string;
}) {
  return (
    <span className="inline-flex items-start gap-2">
      {what ? (
        <span className="pt-[3px] text-xs font-semibold text-white/65">
          {what}:
        </span>
      ) : null}
      <VisibilityControl pageKey={widgetKey} onUnauthorized={onUnauthorized} />
    </span>
  );
}
