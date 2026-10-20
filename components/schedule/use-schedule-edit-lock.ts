"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  acquireScheduleLock,
  isLockUnavailable,
  releaseScheduleLock,
  releaseScheduleLockOnLeave,
  scheduleLockHeartbeat,
} from "@/lib/schedule-lock-api";

const HEARTBEAT_S = 60;
/** 最后一次动手之后多久自动放开（让别人能改）；同 Dispatch 的 15 分钟。 */
const IDLE_EXIT_S = 15 * 60;

export type EnsureResult =
  | { kind: "ok" }
  /** 别人在改（409）：`by` 是后端 detail 里的名字，认不出来就是 null。 */
  | { kind: "busy"; by: string | null; detail: string };

/** 后端 409 的 detail 是一句话，开头是名字：「Sam is editing this schedule …」。 */
function nameFrom(detail: string): string | null {
  const m = /^(.+?) is editing\b/.exec(detail.trim());
  return m ? m[1] : null;
}

/**
 * 排班同一周同时只能一个人编辑（Annie 2026-10-19「动手改才提示」）：打开周表不占用；
 * 第一次动手改（拖人、删班、改时间、Approve / Decline）前 `ensure()` 占住这一周，占住期间定时心跳，
 * 最后一次动手后 15 分钟还占着就放开；换周 / 离开页面也放开。
 * 后端还没有这组接口（404）、或出别的错 ⇒ 不占用、让他照常改（不能因为占用服务出问题就改不了班）。
 */
export function useScheduleEditLock({
  week,
  onUnauthorized,
}: {
  week: string;
  onUnauthorized: () => void;
}) {
  const heldRef = useRef<{ week: string; token: string } | null>(null);
  const pendingRef = useRef<Promise<EnsureResult> | null>(null);
  const lastEditRef = useRef(0);
  const editedRef = useRef(false);
  const everyRef = useRef(HEARTBEAT_S);
  const [holding, setHolding] = useState(false);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const clear = useCallback(() => {
    heldRef.current = null;
    setHolding(false);
  }, []);

  const ensure = useCallback(async (): Promise<EnsureResult> => {
    if (heldRef.current?.week === week) return { kind: "ok" };
    if (pendingRef.current) return pendingRef.current;
    const run = (async (): Promise<EnsureResult> => {
      try {
        const r = await acquireScheduleLock(week);
        heldRef.current = { week, token: r.token };
        everyRef.current = r.heartbeat_every_s ?? HEARTBEAT_S;
        lastEditRef.current = Date.now();
        editedRef.current = false;
        setHolding(true);
        return { kind: "ok" };
      } catch (e) {
        if (isStatus(e, 409)) {
          const detail = describeError(e);
          return { kind: "busy", by: nameFrom(detail), detail };
        }
        if (isStatus(e, 401)) unauthorizedRef.current();
        // 404（还没上线）和别的错：不占用，照常改。
        return { kind: "ok" };
      } finally {
        pendingRef.current = null;
      }
    })();
    pendingRef.current = run;
    return run;
  }, [week]);

  /** 动过手：重新算 15 分钟，下一次心跳带 edited。 */
  const markEdited = useCallback(() => {
    lastEditRef.current = Date.now();
    editedRef.current = true;
  }, []);

  const release = useCallback(async () => {
    const held = heldRef.current;
    clear();
    if (!held) return;
    try {
      await releaseScheduleLock(held.week, held.token);
    } catch (e) {
      void isLockUnavailable(e);
      // 放不开：心跳停了，服务器会自己放开。
    }
  }, [clear]);

  // 换周：放开原来那一周。
  useEffect(() => {
    const held = heldRef.current;
    if (held && held.week !== week) void release();
  }, [week, release]);

  // 心跳：409 ⇒ 编辑已结束（超时 / 重启 / 别的标签页接走），忘掉；下一次动手会重新去占。
  useEffect(() => {
    if (!holding) return;
    const id = setInterval(async () => {
      const held = heldRef.current;
      if (!held) return;
      const edited = editedRef.current;
      editedRef.current = false;
      try {
        await scheduleLockHeartbeat(held.week, held.token, edited);
      } catch (e) {
        if (heldRef.current !== held) return;
        if (isStatus(e, 401)) unauthorizedRef.current();
        else if (isStatus(e, 409) || isLockUnavailable(e)) clear();
      }
    }, everyRef.current * 1000);
    return () => clearInterval(id);
  }, [holding, clear]);

  // 每秒看一次：占着、15 分钟没动手 ⇒ 放开。检查脚本可以设 window.__scheduleIdleExitS 改短。
  useEffect(() => {
    if (!holding) return;
    const id = setInterval(() => {
      const v = (window as { __scheduleIdleExitS?: unknown })
        .__scheduleIdleExitS;
      const limit = (typeof v === "number" && v >= 0 ? v : IDLE_EXIT_S) * 1000;
      if (Date.now() - lastEditRef.current < limit) return;
      void release();
    }, 1000);
    return () => clearInterval(id);
  }, [holding, release]);

  // 关标签 / 刷新 / 离开这一页：放开。
  useEffect(() => {
    const leave = () => {
      const held = heldRef.current;
      if (held) releaseScheduleLockOnLeave(held.week, held.token);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  return { ensure, markEdited, release, holding };
}
