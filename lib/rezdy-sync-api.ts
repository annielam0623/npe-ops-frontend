import { apiFetch } from "@/lib/api-client";
import { describeError } from "@/lib/api-errors";
import type {
  DispatchRezdySyncResult,
  RezdyLastSynced,
  RezdySyncResult,
} from "@/types";
import { ApiError } from "@/types";

/**
 * Sync Rezdy 按键（后端 G70，Annie 2026-10-15）：这一天的订单全部按 Rezdy 对一遍。
 * Main Manifest 和 Dispatch ① Assign 各一个键；Dispatch 那个顺带把各团名单也同步了。
 */

/** 按键左边那行「Last updated from Rezdy」：进页面、换日期时读。 */
export async function fetchRezdyLastSynced(
  date: string,
  signal?: AbortSignal,
): Promise<RezdyLastSynced | null> {
  const r = await apiFetch<{ last_synced: RezdyLastSynced | null }>(
    "/api/manifests/rezdy-sync",
    { cache: "no-store", signal, query: { date } },
  );
  return r.last_synced;
}

/** Main Manifest 的按键。 */
export function syncManifestFromRezdy(date: string): Promise<RezdySyncResult> {
  return apiFetch<RezdySyncResult>("/api/manifests/rezdy-sync", {
    method: "POST",
    body: { date },
  });
}

/** Dispatch ① Assign 的按键：先按 Rezdy 更新订单，再同步各团名单（同 /api/dispatch/manifests/sync）。 */
export function syncDispatchFromRezdy(
  date: string,
): Promise<DispatchRezdySyncResult> {
  const form = new FormData();
  form.append("date", date);
  return apiFetch<DispatchRezdySyncResult>(
    "/api/dispatch/manifests/rezdy-sync",
    { method: "POST", body: form },
  );
}

/**
 * 失败时给 staff 看的话：502 / 409 是 `{ok: false, error}`，400 是 FastAPI 的 `{detail}`，都原样显示。
 */
export function describeRezdySyncError(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { error?: unknown } | null;
    if (body && typeof body.error === "string" && body.error.trim())
      return body.error;
  }
  if (e instanceof TypeError)
    return "Could not reach the server. Nothing was changed.";
  return describeError(e);
}
