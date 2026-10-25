"use client";

import { IBM_Plex_Sans } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";

import { CenteredPage } from "@/components/ui/centered-page";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchAutoSend } from "@/lib/auto-send-api";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  fetchNotificationSwitches,
  fetchScheduleConfirmSettings,
  saveScheduleConfirmSettings,
  setNotificationSwitch,
} from "@/lib/notification-switches-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { AutoSendSettings } from "@/types/auto-send";
import type {
  NotificationSwitch,
  ScheduleConfirmSettings,
} from "@/types/notification-switches";

import {
  AUTO_SEND_KEY,
  FALLBACK_AUTO_SEND,
  FALLBACK_SCHEDULE_CONFIRM,
  SCHEDULE_CONFIRM_KEY,
  sortSwitches,
} from "./config";
import { NotificationCard } from "./notification-card";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

type View =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/**
 * Settings → Notifications（Annie 2026-10-24 看过 preview 后「自动开关：动手」）：系统自己发的通知，
 * 每一项默认关，页面上看得到它什么时候发、发给谁、内容是什么样。
 * - 每日任务提醒、DOR 通知负责人等：GET/PUT /api/settings/notification-switches；
 * - 周三排班确认：开关和发送时刻走 /api/settings/schedule-confirm（PUT 仅 Super Admin）；
 * - 定时自动发送：只显示真实状态（来自 /api/settings/auto-send）+ 链接，不在这里改；整张卡只对 Super Admin 显示。
 * 打开前先确认一次，关闭不用确认。蓝色只给提交键，开关开 = 绿、关 = 灰。
 */
export function NotificationsView() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [items, setItems] = useState<NotificationSwitch[]>([]);
  const [confirm, setConfirm] = useState<ScheduleConfirmSettings | null>(null);
  const [autoSend, setAutoSend] = useState<AutoSendSettings | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        // 只 admin 可读：不是就不请求任何开关接口。
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const list = await fetchNotificationSwitches(signal);
        if (signal.aborted) return;
        setIsSuper(!!me.is_superadmin);

        // 周三排班确认的真实开关 / 时刻来自它自己的接口；读不到就当关（后端同样读不到按关处理）。
        const sc = await fetchScheduleConfirmSettings(signal).catch((error) => {
          if (isStatus(error, 401)) throw error;
          return null;
        });
        // 定时自动发送的状态只有 Super Admin 能读（该接口对其他人 403）。
        const as = me.is_superadmin
          ? await fetchAutoSend(signal).catch((error) => {
              if (isStatus(error, 401)) throw error;
              return null;
            })
          : null;
        if (signal.aborted) return;
        setItems(list);
        setConfirm(sc);
        setAutoSend(as);
        setView({ kind: "ready" });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  /** 页面上实际画的卡：后端没带周三确认 / 定时自动发送时用兜底文字补上；定时自动发送只给 Super Admin。 */
  function visibleItems(): NotificationSwitch[] {
    let list = items.filter((i) => i.key !== AUTO_SEND_KEY || isSuper);
    if (!list.some((i) => i.key === SCHEDULE_CONFIRM_KEY)) {
      list = [...list, FALLBACK_SCHEDULE_CONFIRM];
    }
    if (isSuper && !list.some((i) => i.key === AUTO_SEND_KEY)) {
      list = [...list, FALLBACK_AUTO_SEND];
    }
    return sortSwitches(
      list.map((i) => {
        if (i.key === SCHEDULE_CONFIRM_KEY) {
          // 开关状态以它自己的接口为准；只有 Super Admin 能改。
          return {
            ...i,
            enabled: confirm ? confirm.enabled : false,
            can_edit: isSuper && !!confirm,
          };
        }
        if (i.key === AUTO_SEND_KEY) return { ...i, managed_elsewhere: true };
        return i;
      }),
    );
  }

  function autoSendLines(): string[] | undefined {
    if (!autoSend) return undefined;
    if (!autoSend.readable)
      return ["Settings could not be read (treated as off)"];
    const onOff = (v: boolean) => (v ? "On" : "Off");
    return [
      `Tour confirmations: ${onOff(autoSend.config.tour.enabled)}`,
      `Ticket reminders: ${onOff(autoSend.config.tickets.enabled)}`,
    ];
  }

  const autoSendOn =
    !!autoSend &&
    (autoSend.config.tour.enabled || autoSend.config.tickets.enabled);

  function isOn(item: NotificationSwitch): boolean {
    if (item.key === AUTO_SEND_KEY) return autoSendOn;
    return item.enabled === true && item.wired !== false;
  }

  function setError(key: string, message: string) {
    setErrors((prev) => ({ ...prev, [key]: message }));
  }

  async function reloadList() {
    const list = await fetchNotificationSwitches();
    setItems(list);
  }

  /** 真正写服务器；失败时开关不动，原因写在卡片里。 */
  async function apply(item: NotificationSwitch, enabled: boolean) {
    if (busyKey) return;
    setBusyKey(item.key);
    setError(item.key, "");
    setToast("");
    try {
      if (item.key === SCHEDULE_CONFIRM_KEY) {
        const saved = await saveScheduleConfirmSettings({
          enabled,
          weekday: "wed",
          time: confirm?.time ?? "09:00",
        });
        setConfirm({ ...saved, enabled: saved.enabled === true });
      } else {
        await setNotificationSwitch(item.key, enabled);
        await reloadList();
      }
      setConfirming(null);
      setToast(
        enabled
          ? `“${item.label}” is on.`
          : `“${item.label}” is off. Nothing will be sent.`,
      );
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setError(item.key, `Not changed: ${describeError(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function saveTime(item: NotificationSwitch, time: string) {
    if (busyKey || !confirm) return;
    setBusyKey(item.key);
    setError(item.key, "");
    setToast("");
    try {
      const saved = await saveScheduleConfirmSettings({
        enabled: confirm.enabled,
        weekday: "wed",
        time,
      });
      setConfirm(saved);
      setToast(`Send time saved: Wednesdays at ${saved.time}.`);
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setError(item.key, `Time not saved: ${describeError(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  const shown = view.kind === "ready" ? visibleItems() : [];
  const onItems = shown.filter(isOn);
  let lastGroup = "";

  return (
    <CenteredPage as="main" className={cn(plex.className, "text-[#f8fafc]")}>
      <h1 className="sr-only">Notifications</h1>
      <p className="mb-4 max-w-[70ch] text-[13px] text-white/60">
        Messages the system sends by itself. Each one is off until you turn it
        on. Open Details to see when it sends, who gets it, and what it says.
      </p>

      {view.kind === "loading" ? (
        <Box>Loading…</Box>
      ) : view.kind === "forbidden" ? (
        <Box>
          <p className="font-semibold">Admin access required</p>
          <p className="mt-1 text-white/60">
            Only admins can see automatic notifications.
          </p>
        </Box>
      ) : view.kind === "error" ? (
        <ErrorBanner
          dark
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Failed to load notifications: {view.message}
        </ErrorBanner>
      ) : (
        <>
          {onItems.length === 0 ? (
            <div
              role="status"
              data-banner="all-off"
              className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[#fbbf24]/50 bg-[#fbbf24]/[.08] px-3.5 py-2.5 text-[13.5px] text-[#fde68a]"
            >
              <b>All {shown.length} automatic notifications are OFF.</b>
              <span>Nothing is being sent by itself.</span>
            </div>
          ) : (
            <div
              role="status"
              data-banner="some-on"
              className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[#4ade80]/45 bg-[#4ade80]/[.07] px-3.5 py-2.5 text-[13.5px] text-[#bbf7d0]"
            >
              <b>
                {onItems.length} of {shown.length} automatic notifications are
                ON.
              </b>
              <span>{onItems.map((i) => i.label).join(", ")}</span>
            </div>
          )}

          {shown.map((item) => {
            const group = item.group ?? "";
            const heading =
              group !== lastGroup ? (
                <div
                  key={`g-${group}-${item.key}`}
                  className="mt-[18px] mb-2 text-[11.5px] font-bold tracking-[.08em] text-white/60 uppercase first:mt-0"
                >
                  {group || "Other"}
                </div>
              ) : null;
            lastGroup = group;
            const isSchedule = item.key === SCHEDULE_CONFIRM_KEY;
            return (
              <div key={item.key}>
                {heading}
                <NotificationCard
                  item={item}
                  on={isOn(item)}
                  statusLines={
                    item.key === AUTO_SEND_KEY ? autoSendLines() : undefined
                  }
                  busy={busyKey === item.key}
                  error={errors[item.key] ?? ""}
                  confirming={confirming === item.key}
                  timeEditor={
                    isSchedule && confirm
                      ? {
                          saved: confirm.time,
                          saving: busyKey === item.key,
                          onSave: (t) => void saveTime(item, t),
                        }
                      : undefined
                  }
                  onToggle={() => {
                    setToast("");
                    if (isOn(item)) void apply(item, false);
                    else setConfirming(item.key);
                  }}
                  onConfirm={() => void apply(item, true)}
                  onCancel={() => setConfirming(null)}
                />
              </div>
            );
          })}
          <p
            role="status"
            className="mt-2 min-h-[18px] text-[12.5px] text-[#86efac]"
          >
            {toast}
          </p>
        </>
      )}
    </CenteredPage>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[.032] px-[22px] py-10 text-center text-sm text-white/60">
      {children}
    </div>
  );
}
