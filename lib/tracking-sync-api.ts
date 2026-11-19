import { apiFetch } from "@/lib/api-client";

/**
 * G180 Main manifest → Tour Tracking 同步的三档开关（后端 15d41632，只给 Super Admin，改动记 action_log）：
 * off = 谁都看不到灰行；super_admin_only = 只有 Super Admin 看得到；staff = 能开这页的人都看得到。
 */
export type TrackingSyncMode = "off" | "super_admin_only" | "staff";

export interface TrackingSyncSetting {
  mode: TrackingSyncMode;
  enabled?: boolean;
}

/** Tour Tracking 的开关（G180）。 */
export const TOUR_SYNC_API = "/api/settings/tracking-sync";
/** G281：Ticket Tracking 的开关，跟 Tour 的是两个独立开关，三档、权限、回包同一个样子。 */
export const TICKETS_SYNC_API = "/api/settings/tickets-sync";

export function fetchTrackingSync(
  signal?: AbortSignal,
  api: string = TOUR_SYNC_API,
): Promise<TrackingSyncSetting> {
  return apiFetch<TrackingSyncSetting>(api, { cache: "no-store", signal });
}

export function saveTrackingSync(
  mode: TrackingSyncMode,
  api: string = TOUR_SYNC_API,
): Promise<TrackingSyncSetting> {
  return apiFetch<TrackingSyncSetting>(api, { method: "PUT", body: { mode } });
}
