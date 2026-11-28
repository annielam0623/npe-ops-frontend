import { apiFetch } from "@/lib/api-client";
import type { DispatchEditTiming } from "@/types";

/*
 * Super Admin 接手编辑权（Annie 2026-11-27「两个都加，只给super admin，动手」；preview v3 HnwCg1oWJgYGuaiB72QPfz，
 * K1 A / K2 A / K3 A）。后端 99286cc5，接口说明 docs/interfaces/lock-takeover-2026-11-27.md。
 * 谁在编辑：GET …/edit-lock（can_take_over 只有 Super Admin 是 true）；接手：POST …/edit-lock/take-over。
 * 被接手的人：旧 token 的任何请求都回 409 {detail: {detail, code: "lock_taken_over"}}，前端照原话显示（describeError 读里层）。
 */

export interface EditLockHolder {
  by: string;
  /** ISO 时间。 */
  since: string;
  /** 最后一次改动（ISO）；旧后端没有。 */
  last_edit?: string | null;
  by_me: boolean;
}

export interface EditLockStatus {
  edit_lock: EditLockHolder | null;
  can_take_over: boolean;
}

export const LOCK_TAKEN_OVER = "lock_taken_over";
export const HOLDER_CHANGED = "holder_changed";

// ── Dispatch（一天一把锁）──
export function fetchDispatchLockStatus(date: string): Promise<EditLockStatus> {
  return apiFetch<EditLockStatus>("/api/dispatch/edit-lock", {
    query: { date },
    cache: "no-store",
  });
}

export function takeOverDispatchLock(
  date: string,
  version: string | null,
  holderSince: string,
): Promise<{
  token: string;
  stale: boolean;
  version: string;
  edit_timing?: DispatchEditTiming;
}> {
  return apiFetch("/api/dispatch/edit-lock/take-over", {
    method: "POST",
    body: { date, version, holder_since: holderSince },
  });
}

// ── 排班（一周一把锁）──
export function fetchScheduleLockStatus(week: string): Promise<EditLockStatus> {
  return apiFetch<EditLockStatus>(`/api/schedule/weeks/${week}/edit-lock`, {
    cache: "no-store",
  });
}

export function takeOverScheduleLock(
  week: string,
  holderSince: string,
): Promise<{ token: string; heartbeat_every_s?: number }> {
  return apiFetch(`/api/schedule/weeks/${week}/edit-lock/take-over`, {
    method: "POST",
    body: { holder_since: holderSince },
  });
}
