"use client";

import { useCallback, useEffect, useRef } from "react";

import { isStatus } from "@/lib/api-errors";
import {
  acquireScheduleLock,
  isLockUnavailable,
  releaseScheduleLock,
  releaseScheduleLockOnLeave,
  scheduleLockHeartbeat,
} from "@/lib/schedule-lock-api";
import { ApiError } from "@/types";

/*
 * 总览跨几周编辑：每周照现有的编辑锁（POST /api/schedule/weeks/{w}/edit-lock + heartbeat / release，同 Staff Schedule，
 * Annie 2026-10-19「动手改才提示」）。打开不占；第一次动手改到某一周时才占那一周。range/changes 认的就是这个 token（后端 86）。
 * 接口没有（404）= 不占、照常改（同 use-schedule-edit-lock.ts）。
 */

export type LockResult = { ok: true } | { ok: false; detail: string };

const HEARTBEAT_MS = 60_000;

export function useRangeLocks(onUnauthorized: () => void) {
  /** week → token；null = 接口没有，当占到了。 */
  const held = useRef(new Map<string, string | null>());
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const ensure = useCallback(async (weeks: string[]): Promise<LockResult> => {
    for (const w of weeks) {
      if (held.current.has(w)) continue;
      try {
        const r = await acquireScheduleLock(w);
        held.current.set(w, r.token);
      } catch (error) {
        if (isLockUnavailable(error)) {
          held.current.set(w, null);
          continue;
        }
        if (isStatus(error, 401)) {
          unauthorized.current();
          return { ok: false, detail: "Please sign in again." };
        }
        const detail =
          error instanceof ApiError &&
          typeof (error.body as { detail?: unknown } | null)?.detail === "string"
            ? String((error.body as { detail: string }).detail)
            : "Someone else is editing this week. Please try again later.";
        return { ok: false, detail };
      }
    }
    return { ok: true };
  }, []);

  const token = useCallback((w: string) => held.current.get(w) ?? null, []);

  /** 存的回包里有新 token（锁过期后后端当场重占）就换上。 */
  const adopt = useCallback((w: string, t: string | null | undefined) => {
    if (t && held.current.has(w)) held.current.set(w, t);
  }, []);

  const releaseAll = useCallback(() => {
    for (const [w, t] of held.current) if (t) void releaseScheduleLock(w, t).catch(() => {});
    held.current.clear();
  }, []);

  useEffect(() => {
    const map = held.current;
    const timer = window.setInterval(() => {
      for (const [w, t] of map)
        if (t)
          void scheduleLockHeartbeat(w, t, true).catch((error) => {
            // 409 = 编辑已结束；下次动手再占。
            if (isStatus(error, 409)) map.delete(w);
          });
    }, HEARTBEAT_MS);
    const leave = () => {
      for (const [w, t] of map) if (t) releaseScheduleLockOnLeave(w, t);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
      map.clear();
    };
  }, []);

  return { ensure, token, adopt, releaseAll };
}
