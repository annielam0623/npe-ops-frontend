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

const API = "/api/settings/tracking-sync";

export function fetchTrackingSync(
  signal?: AbortSignal,
): Promise<TrackingSyncSetting> {
  return apiFetch<TrackingSyncSetting>(API, { cache: "no-store", signal });
}

export function saveTrackingSync(
  mode: TrackingSyncMode,
): Promise<TrackingSyncSetting> {
  return apiFetch<TrackingSyncSetting>(API, { method: "PUT", body: { mode } });
}
