import { apiFetch } from "@/lib/api-client";

/** 后端白名单里的偏好键（app/routers/user_prefs.py）；与旧页面共用，两边的设置互通。 */
export type UserPrefKey =
  | "morning_col_order"
  | "tour_col_order"
  /** ops 门票跟踪页的列设置 {order, hide, file}（ops 自己的格式，旧页面不用）。 */
  | "tickets_col_order"
  /** HR 列表的列顺序 / 列宽（后端 2026-10-04 起认）。 */
  | "hr_list_layout";

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
