"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  acquireEditLock,
  editLockHeartbeat,
  releaseEditLock,
  releaseEditLockOnLeave,
} from "@/lib/dispatch-api";
import { LA_TIME_ZONE } from "@/lib/la-date";
import type { DispatchEditLock, DispatchEditTiming } from "@/types";

/** 后端没给 edit_timing 时用的数（同后端默认）。 */
const DEFAULT_TIMING: DispatchEditTiming = {
  remind_after_s: 600,
  auto_save_after_s: 300,
  heartbeat_every_s: 60,
};

const SINCE = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** 别人在改时的那句话（同后端 409 的 detail）。 */
export function lockedByText(lock: DispatchEditLock): string {
  const at = new Date(lock.since);
  const since = Number.isNaN(at.getTime())
    ? ""
    : ` (since ${SINCE.format(at).replace(/\s/g, " ")})`;
  return `${lock.by} is editing this day${since}. You can look, but you cannot change it until they save or leave.`;
}

export type EnsureResult =
  | { kind: "ok" }
  /** 占住了，但打开之后别人存过：先重读这一天再让他改。 */
  | { kind: "stale" }
  /** 别人在改（409）。 */
  | { kind: "busy"; detail: string }
  | { kind: "error"; detail: string };

/**
 * 占着这一天、最后一次动手之后多久自动退出编辑（Annie 2026-10-15：去掉 10 分钟的 Save / Exit 提醒，
 * 改成 15 分钟没动手就退出，不弹窗）。改动是自动保存的（存好服务器就放开），还占着多半是有存不上的改动（例如车没司机）。
 */
export const IDLE_EXIT_S = 15 * 60;

/** 检查脚本可以设 `window.__dispatchIdleExitS` 把 15 分钟改短。 */
function idleExitMs(): number {
  const v = (window as { __dispatchIdleExitS?: unknown }).__dispatchIdleExitS;
  return (typeof v === "number" && v >= 0 ? v : IDLE_EXIT_S) * 1000;
}

/**
 * Dispatch 同一天同时只能一个人编辑（后端 G71，Annie 2026-10-15 看过预览）：
 * 第一次动手前 `ensure()` 占住；占住期间按 heartbeat_every_s 心跳；最后一次动手后 IDLE_EXIT_S 秒还占着 ⇒ 放开、调 `onIdleExit`。
 * 心跳 409 ⇒ `ended` 写后端原话，不再算占住。关页面 / 组件卸载时用 keepalive 放开；换日期由页面调 `release()`。
 */
export function useEditLock({
  date,
  version,
  timing,
  onUnauthorized,
  onIdleExit,
}: {
  date: string | null;
  version: string | null;
  timing: DispatchEditTiming | undefined;
  onUnauthorized: () => void;
  onIdleExit: () => void;
}) {
  const t = timing ?? DEFAULT_TIMING;
  const tokenRef = useRef<{ date: string; token: string } | null>(null);
  const pendingRef = useRef<Promise<EnsureResult> | null>(null);
  const lastEditRef = useRef(0);
  const editedRef = useRef(false);
  const [holding, setHolding] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const onIdleExitRef = useRef(onIdleExit);
  onIdleExitRef.current = onIdleExit;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const clear = useCallback(() => {
    tokenRef.current = null;
    setHolding(false);
  }, []);

  /** 已经占着就直接 ok；没占着就去占（同一时间只发一次）。 */
  const ensure = useCallback(async (): Promise<EnsureResult> => {
    if (!date) return { kind: "error", detail: "No day is open." };
    if (tokenRef.current?.date === date) return { kind: "ok" };
    if (pendingRef.current) return pendingRef.current;
    const run = (async (): Promise<EnsureResult> => {
      setAcquiring(true);
      try {
        const r = await acquireEditLock(date, version);
        tokenRef.current = { date, token: r.token };
        lastEditRef.current = Date.now();
        editedRef.current = false;
        setEnded(null);
        setHolding(true);
        return r.stale ? { kind: "stale" } : { kind: "ok" };
      } catch (e) {
        if (isStatus(e, 401)) {
          onUnauthorizedRef.current();
          return { kind: "error", detail: "Your login expired." };
        }
        if (isStatus(e, 409)) return { kind: "busy", detail: describeError(e) };
        return {
          kind: "error",
          detail:
            e instanceof TypeError
              ? "Could not reach the server. Check your connection and try again."
              : describeError(e),
        };
      } finally {
        setAcquiring(false);
        pendingRef.current = null;
      }
    })();
    pendingRef.current = run;
    return run;
  }, [date, version]);

  /** 动过手：重新算 15 分钟，下一次心跳带 edited。 */
  const markEdited = useCallback(() => {
    lastEditRef.current = Date.now();
    editedRef.current = true;
  }, []);

  /** 不保存就放开（换日期）。放不开也不报错：服务器会超时放开。 */
  const release = useCallback(async () => {
    const held = tokenRef.current;
    clear();
    if (!held) return;
    try {
      await releaseEditLock(held.date, held.token);
    } catch {
      // 心跳断了服务器 3 分钟后自己放开。
    }
  }, [clear]);

  /** 存好 / 复制好：服务器已经放开了，这边只忘掉。 */
  const forget = clear;

  const token = useCallback(
    () => (tokenRef.current?.date === date ? tokenRef.current.token : null),
    [date],
  );

  // 心跳：409 ⇒ 编辑已结束（超时 / 服务器重启 / 别的标签页接走）。
  useEffect(() => {
    if (!holding) return;
    const id = setInterval(async () => {
      const held = tokenRef.current;
      if (!held) return;
      const edited = editedRef.current;
      editedRef.current = false;
      try {
        await editLockHeartbeat(held.date, held.token, edited);
      } catch (e) {
        if (tokenRef.current !== held) return;
        if (isStatus(e, 401)) onUnauthorizedRef.current();
        else if (isStatus(e, 409)) {
          clear();
          setEnded(describeError(e));
        }
        // 断网等：下一次再试。
      }
    }, t.heartbeat_every_s * 1000);
    return () => clearInterval(id);
  }, [holding, t.heartbeat_every_s, clear]);

  // 每秒看一次：占着、15 分钟没动手 ⇒ 放开（让别人能改），告诉页面。
  useEffect(() => {
    if (!holding) return;
    const id = setInterval(() => {
      if (Date.now() - lastEditRef.current < idleExitMs()) return;
      const held = tokenRef.current;
      clear();
      if (held)
        void releaseEditLock(held.date, held.token).catch(() => {
          // 放不开：心跳停了，服务器 3 分钟后自己放开。
        });
      onIdleExitRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [holding, clear]);

  // 关标签 / 刷新 / 离开这一页：放开（没存的改动由离开提醒先问过）。
  useEffect(() => {
    const leave = () => {
      const held = tokenRef.current;
      if (held) releaseEditLockOnLeave(held.date, held.token);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  return {
    ensure,
    markEdited,
    release,
    forget,
    token,
    holding,
    acquiring,
    ended,
    clearEnded: () => setEnded(null),
    timing: t,
  };
}
