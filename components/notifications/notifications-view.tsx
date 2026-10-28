"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";
import { CenteredPage } from "@/components/ui/centered-page";
import { plex } from "@/components/ui/plex-font";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  fetchNotificationSwitches,
  fetchScheduleConfirmSettings,
  saveScheduleConfirmSettings,
  setNotificationSwitches,
} from "@/lib/notification-switches-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { NotificationSwitch } from "@/types/notification-switches";

import {
  AUTO_SEND_CARD,
  AUTO_SEND_KEY,
  AUTO_SEND_PREFIX,
  SCHEDULE_CONFIRM_KEY,
  sortSwitches,
  withFallbackText,
} from "./config";
import { NotificationCard } from "./notification-card";
import { PageVisibilityList } from "./page-visibility-list";

type View =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** 定时自动发送两项在页面上的名字（后端是 auto_send_tour / auto_send_tickets 两项）。 */
const AUTO_SEND_NAME: Record<string, string> = {
  auto_send_tour: "Tour confirmations",
  auto_send_tickets: "Ticket reminders",
};

/**
 * Settings → Notifications（Annie 2026-10-24 看过 preview 后「自动开关：动手」）：系统自己发的通知，
 * 每一项默认关，页面上看得到它什么时候发、发给谁、内容是什么样。接口是后端 GET/PUT /api/settings/notification-switches：
 * - 每日任务提醒、DOR 通知负责人、周三排班确认都在这个列表里，PUT {switches:{key:bool}}，返回整份直接刷新；
 * - 周三排班确认的发送时刻走 /api/settings/schedule-confirm（PUT 仅 Super Admin）；
 * - 定时自动发送（auto_send_tour / auto_send_tickets，只在 Super Admin 的响应里）合成一张卡，只显示真实状态 + 链接。
 * 打开前先确认一次，关闭不用确认。蓝色只给提交键，开关开 = 绿、关 = 灰。
 */
export function NotificationsView() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [items, setItems] = useState<NotificationSwitch[]>([]);
  const [readable, setReadable] = useState(true);
  const [scTime, setScTime] = useState<string | null>(null);
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
        // 周三排班确认的发送时刻来自它自己的接口；读不到就不显示时间框（开关照样能用）。
        const sc = await fetchScheduleConfirmSettings(signal).catch((error) => {
          if (isStatus(error, 401)) throw error;
          return null;
        });
        if (signal.aborted) return;
        setIsSuper(!!me.is_superadmin);
        setItems(list.switches);
        setReadable(list.readable);
        setScTime(sc?.time ?? null);
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

  /** auto_send_tour / auto_send_tickets 两项（后端只给 Super Admin）。 */
  const autoItems = items.filter((i) => i.key.startsWith(AUTO_SEND_PREFIX));

  /** 页面上实际画的卡：定时自动发送两项合成一张（只给 Super Admin）；缺的 trigger / recipients / sample 用兜底文案补上。 */
  function visibleItems(): NotificationSwitch[] {
    const own = items.filter((i) => !i.key.startsWith(AUTO_SEND_PREFIX));
    const list = own.map(withFallbackText);
    if (isSuper && autoItems.length) {
      list.push({
        ...AUTO_SEND_CARD,
        enabled: autoItems.some((i) => i.enabled),
      });
    }
    return sortSwitches(list);
  }

  function autoSendLines(): string[] {
    return autoItems.map(
      (i) => `${AUTO_SEND_NAME[i.key] ?? i.label}: ${i.enabled ? "On" : "Off"}`,
    );
  }

  function isOn(item: NotificationSwitch): boolean {
    return item.enabled === true && item.wired !== false;
  }

  function setError(key: string, message: string) {
    setErrors((prev) => ({ ...prev, [key]: message }));
  }

  /** 真正写服务器；成功用返回的整份刷新，失败时开关不动、原因写在卡片里。 */
  async function apply(item: NotificationSwitch, enabled: boolean) {
    if (busyKey) return;
    setBusyKey(item.key);
    setError(item.key, "");
    setToast("");
    try {
      const res = await setNotificationSwitches({ [item.key]: enabled });
      setItems(res.switches);
      setReadable(res.readable);
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
    if (busyKey) return;
    setBusyKey(item.key);
    setError(item.key, "");
    setToast("");
    try {
      const saved = await saveScheduleConfirmSettings({
        enabled: item.enabled,
        weekday: "wed",
        time,
      });
      setScTime(saved.time);
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
          {!readable ? (
            <p
              role="alert"
              data-unreadable
              className="mb-3 rounded-[10px] border border-[#fbbf24]/40 bg-[#fbbf24]/[.07] px-3.5 py-2.5 text-[13px] text-[#fde68a]"
            >
              The notification settings could not be read, so everything is
              treated as off. Changing a switch saves them again.
            </p>
          ) : null}
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
                    isSchedule && scTime
                      ? {
                          saved: scTime,
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
          <PageVisibilityList onUnauthorized={redirectToLogin} />
          <ActionLogPanel
            refreshKey={0}
            reloadOnOpen
            onUnauthorized={redirectToLogin}
            load={(before, signal) =>
              fetchActionLog(
                "/api/settings/notification-switches/action-log",
                before,
                signal,
              )
            }
          />
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
