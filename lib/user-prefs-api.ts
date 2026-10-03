import { apiFetch } from "@/lib/api-client";

/** 后端白名单里的偏好键（app/routers/user_prefs.py）；与旧页面共用，两边的设置互通。 */
export type UserPrefKey = "morning_col_order" | "tour_col_order";

/** 没存过时 value 为 null。 */
export async function fetchUserPref(
  key: UserPrefKey,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await apiFetch<{ key: string; value: string | null }>(
    `/api/user-prefs/${key}`,
    { cache: "no-store", signal },
  );
  return result.value;
}

export async function saveUserPref(
  key: UserPrefKey,
  value: string,
): Promise<void> {
  await apiFetch(`/api/user-prefs/${key}`, {
    method: "PUT",
    body: { value },
  });
}
