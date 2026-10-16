import type { DispatchSyncResult } from "./dispatch-manifest";

/**
 * Sync Rezdy 按键（后端 G70，Annie 2026-10-15）。全部 require_staff。
 * `GET /api/manifests/rezdy-sync?date=`：这一天上次成功同步的时间（ISO）和人；没同步过 = null。
 */
export interface RezdyLastSynced {
  at: string;
  by: string;
}

/**
 * `POST /api/manifests/rezdy-sync`（JSON {date}）成功的返回；四个列表都是订单号。
 * G74：Main Manifest 这边也顺带同步 Dispatch 团名单；只有团名单那步出错时
 * `guest_lists: null` + `guest_lists_error`（给 staff 看的一句话，Main manifest 已更新）。
 */
export interface RezdySyncResult {
  ok: true;
  last_synced: RezdyLastSynced | null;
  checked: number;
  new: string[];
  cancelled: string[];
  changed: string[];
  failed: string[];
  guest_lists_error?: string;
}

/**
 * `POST /api/dispatch/manifests/rezdy-sync`（Form date）：同上，再加各团名单的同步结果
 * （形状 = `/api/dispatch/manifests/sync` 的返回），不用再调 /sync。
 */
export interface DispatchRezdySyncResult extends RezdySyncResult {
  run_date: string;
  guest_lists: DispatchSyncResult;
}
