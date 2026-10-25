"use client";

import { useEffect, useState, type ReactNode } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchDashboardWidgets,
  updateDashboardWidgets,
} from "@/lib/daily-report-api";
import { cn } from "@/lib/utils";

/**
 * 本批新加的 Dashboard 板块 / 功能（Annie 2026-10-25「给新的板块都要设置开关，只能 super admin 才能看到和执行」）：
 * 和 Daily Operation Report 一样，默认只 Super Admin 看得到、用得了；Super Admin 在版面上切「员工可见」。
 * key 由后端 dashboard_widgets 登记（同 DOR 的 daily_operation_report）。
 */
export const WIDGET_STATS = "dashboard_stats";
export const WIDGET_TODAY_TEAM = "dashboard_today_team";
export const WIDGET_REPLY = "dashboard_reply";
/**
 * 已经在线上给员工用的两块（Annie 2026-10-25「把task和notice都加上开关」）：同样的开关，但**默认员工可见**，
 * Super Admin 可以关掉。注意和上面三个相反：key 读不到时这两个当「员工可见」，不能因为加了开关把现有功能默默藏起来。
 */
export const WIDGET_NOTICE = "dashboard_notice";
export const WIDGET_TASKS = "dashboard_tasks";

const KEYS = [
  WIDGET_STATS,
  WIDGET_TODAY_TEAM,
  WIDGET_REPLY,
  WIDGET_NOTICE,
  WIDGET_TASKS,
] as const;
type GateKey = (typeof KEYS)[number];
const STAFF_BY_DEFAULT: ReadonlySet<GateKey> = new Set([
  WIDGET_NOTICE,
  WIDGET_TASKS,
]);

/** 传给板块自己画的部分：Super Admin 的开关（其他人 null）+ 还没放给员工时画黄色虚线框。 */
export interface BlockGate {
  staffSwitch: ReactNode;
  hiddenFromStaff: boolean;
}

export interface WidgetGate {
  /** 对我可见 / 可用吗。 */
  visible: boolean;
  /** 当前是否已放给员工（Super Admin 的开关显示用）。 */
  staffSees: boolean;
}

export type WidgetGates = Record<GateKey, WidgetGate> & {
  loaded: boolean;
  setStaffSees: (key: GateKey, staffSees: boolean) => void;
};

/**
 * 只信后端的 visible_to_me。后端还没登记这个 key（或接口读不到）时：
 * - 新板块（统计行 / Today's team / Reply 弹框）：Super Admin 可见、其他人不可见——和后端默认 super_admin_only 一致，
 *   key 注册前 Super Admin 也照样能看、能验收；读完之前当不可见，避免员工先闪一下再消失。
 * - Notice / 任务块：所有人可见（员工一直在用，默认 staff）；读完之前也当可见，不让现有块闪一下。
 */
/** 这个 key 后端读不到时怎么算（见 useWidgetGates 的说明）。 */
function fallbackGate(k: GateKey, isSuperAdmin: boolean): WidgetGate {
  return STAFF_BY_DEFAULT.has(k)
    ? { visible: true, staffSees: true }
    : { visible: isSuperAdmin, staffSees: false };
}

export function useWidgetGates(
  isSuperAdmin: boolean,
  onUnauthorized: () => void,
): WidgetGates {
  const [loaded, setLoaded] = useState(false);
  const [gates, setGates] = useState<Record<GateKey, WidgetGate>>(
    () =>
      Object.fromEntries(
        KEYS.map((k) => [
          k,
          STAFF_BY_DEFAULT.has(k)
            ? { visible: true, staffSees: true }
            : { visible: false, staffSees: false },
        ]),
      ) as Record<GateKey, WidgetGate>,
  );

  useEffect(() => {
    const controller = new AbortController();
    const fromList = (
      widgets: { key: string; visibility: string; visible_to_me: boolean }[],
    ) =>
      Object.fromEntries(
        KEYS.map((k) => {
          const w = widgets.find((x) => x.key === k);
          return [
            k,
            w
              ? {
                  visible: w.visible_to_me,
                  staffSees: w.visibility === "staff",
                }
              : fallbackGate(k, isSuperAdmin),
          ];
        }),
      ) as Record<GateKey, WidgetGate>;
    (async () => {
      try {
        const data = await fetchDashboardWidgets(controller.signal);
        if (controller.signal.aborted) return;
        setGates(fromList(data.widgets));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        setGates(fromList([]));
      }
      setLoaded(true);
    })();
    return () => controller.abort();
  }, [isSuperAdmin, onUnauthorized]);

  return {
    ...gates,
    loaded,
    setStaffSees: (key, staffSees) =>
      setGates((g) => ({
        ...g,
        [key]: { ...(g[key] ?? fallbackGate(key, isSuperAdmin)), staffSees },
      })),
  };
}

/** 板块「员工可见 / 不可见」开关（Annie 2026-10-24 选 A：标题行右侧，旁边一行字写明状态）。DOR 块同用。 */
export function StaffVisibilitySwitch({
  staffSees,
  busy,
  onToggle,
  what,
}: {
  staffSees: boolean;
  busy: boolean;
  onToggle: () => void;
  /** 功能（不是整块）时在状态字前面写明是哪个功能，例如「Reply pop-up」。 */
  what?: string;
}) {
  const prefix = what ? `${what}: ` : "";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-white/60">
      <span
        data-staff-state
        className={cn(
          "font-bold",
          staffSees ? "text-[#4ade80]" : "text-[#fbbf24]",
        )}
      >
        <span
          aria-hidden
          className="mr-1.5 inline-block size-2 rounded-full bg-current"
        />
        {prefix}
        {staffSees
          ? what
            ? "staff can use it"
            : "Visible to staff"
          : what
            ? "staff can’t use it"
            : "Staff can’t see this"}
      </span>
      {/* 开 = 绿（员工看得到），关 = 灰；不用蓝色（蓝色只给提交键）。 */}
      <button
        type="button"
        role="switch"
        aria-checked={staffSees}
        aria-label={what ? `Let staff use ${what}` : "Show this block to staff"}
        disabled={busy}
        onClick={onToggle}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border disabled:opacity-60",
          "after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:transition-transform",
          staffSees
            ? "border-[#4ade80] bg-[#4ade80]/[.28] after:translate-x-4 after:bg-[#4ade80]"
            : "border-white/35 bg-white/10 after:bg-[#cbd5e1]",
        )}
      />
    </span>
  );
}

/**
 * 带保存的开关：PUT 只有 Super Admin 能写；成功后以后端返回的为准，失败原样写出原因（例如后端还没登记这个 key）。
 */
export function WidgetStaffSwitch({
  widgetKey,
  gates,
  onUnauthorized,
  what,
}: {
  widgetKey: GateKey;
  gates: WidgetGates;
  onUnauthorized: () => void;
  what?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const staffSees = gates[widgetKey].staffSees;

  async function toggle() {
    if (busy) return;
    const next = !staffSees;
    setBusy(true);
    setError("");
    try {
      const result = await updateDashboardWidgets({
        [widgetKey]: next ? "staff" : "super_admin_only",
      });
      const w = result.widgets.find((x) => x.key === widgetKey);
      gates.setStaffSees(widgetKey, w ? w.visibility === "staff" : next);
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <StaffVisibilitySwitch
        staffSees={staffSees}
        busy={busy}
        onToggle={() => void toggle()}
        what={what}
      />
      {error ? (
        <span role="alert" className="text-[12px] text-[#f87171]">
          Could not change who can see this: {error}
        </span>
      ) : null}
    </span>
  );
}
