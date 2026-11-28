"use client";

import { useCallback, useEffect, useRef } from "react";

import { describeError, errorCode, isStatus } from "@/lib/api-errors";
import { LOCK_TAKEN_OVER } from "@/lib/edit-lock-takeover";
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
 *
 * Super Admin 接手（lock-takeover 2026-11-27）：
 * - 别人占着 ⇒ ensure 回 busy + 是哪一周（页面去问 GET edit-lock 要不要出 Take over）；接手成功 ⇒ take(w, token)。
 * - 被接手：心跳回 409 lock_taken_over ⇒ onLost(原话)，页面只能看。普通的「编辑已结束」照旧悄悄去掉，下次动手再占。
 * - SA-3：存之前 verify() 给每个占着的周心跳一次、等回来；409（被接手 / 已结束）⇒ 不存。
 */

export type LockResult =
  | { ok: true }
  | { ok: false; detail: string; week?: string; busy?: boolean };

const HEARTBEAT_MS = 60_000;

export function useRangeLocks(
  onUnauthorized: () => void,
  onLost?: (detail: string) => void,
) {
  /** week → token；null = 接口没有，当占到了。 */
  const held = useRef(new Map<string, string | null>());
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  const lost = useRef(onLost);
  lost.current = onLost;

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
        return { ok: false, detail, week: w, busy: isStatus(error, 409) };
      }
    }
    return { ok: true };
  }, []);

  const token = useCallback((w: string) => held.current.get(w) ?? null, []);

  /** 存的回包里有新 token（锁过期后后端当场重占）就换上。 */
  const adopt = useCallback((w: string, t: string | null | undefined) => {
    if (t && held.current.has(w)) held.current.set(w, t);
  }, []);

  /** Super Admin 接手成功：这一周用新 token。 */
  const take = useCallback((w: string, t: string) => {
    held.current.set(w, t);
  }, []);

  const releaseAll = useCallback(() => {
    for (const [w, t] of held.current) if (t) void releaseScheduleLock(w, t).catch(() => {});
    held.current.clear();
  }, []);

  /** token 已经作废（被接手）：只忘掉，不去放（放也是 409）。 */
  const forgetAll = useCallback(() => {
    held.current.clear();
  }, []);

  /** SA-3：存之前给每个占着的周心跳一次并等回来。409 ⇒ 那一周的原话（不存）；断网等别的错不挡（存的时候自己会报）。 */
  const verify = useCallback(async (): Promise<LockResult> => {
    const list = [...held.current].filter(([, t]) => !!t) as [string, string][];
    const results = await Promise.all(
      list.map(async ([w, t]) => {
        try {
          await scheduleLockHeartbeat(w, t, true);
          return null;
        } catch (error) {
          return { w, error };
        }
      }),
    );
    for (const r of results) {
      if (!r) continue;
      if (isStatus(r.error, 401)) {
        unauthorized.current();
        return { ok: false, detail: "Please sign in again." };
      }
      if (isStatus(r.error, 409)) {
        held.current.delete(r.w);
        return { ok: false, detail: describeError(r.error), week: r.w };
      }
    }
    return { ok: true };
  }, []);

  useEffect(() => {
    const map = held.current;
    const timer = window.setInterval(() => {
      for (const [w, t] of map)
        if (t)
          void scheduleLockHeartbeat(w, t, true).catch((error) => {
            if (!isStatus(error, 409) || map.get(w) !== t) return;
            map.delete(w);
            // 被 Super Admin 接手：告诉页面（只能看）。别的 409 = 编辑已结束，下次动手再占（照旧）。
            if (errorCode(error) === LOCK_TAKEN_OVER) lost.current?.(describeError(error));
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

  return { ensure, token, adopt, take, releaseAll, forgetAll, verify };
}
