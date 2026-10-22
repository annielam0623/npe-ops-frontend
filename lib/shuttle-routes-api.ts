import { apiFetch } from "@/lib/api-client";

/**
 * Content Studio → Shuttle 模块（后端 G128）：路线 = 一个 shuttle Group（Products 里
 * `booking_type = "shuttle"` 的组）× 一个方向。admin only。
 */
export type ShuttleDirection = "outbound" | "inbound";

export interface ShuttleRoute {
  id: number;
  manifest_id: number;
  direction: ShuttleDirection;
  label: string;
  sort_order: number;
  is_active: boolean;
  group_name: string;
  group_display_name: string;
}

/** 「+ Add route」下拉候选：所有 booking_type = shuttle 的 Group。 */
export interface ShuttleGroupOption {
  id: number;
  name: string;
  display_name: string;
  is_active: boolean;
}

interface ShuttleRoutesResponse {
  routes: ShuttleRoute[];
  shuttle_groups: ShuttleGroupOption[];
}

export function fetchShuttleRoutes(
  signal?: AbortSignal,
): Promise<ShuttleRoutesResponse> {
  return apiFetch<ShuttleRoutesResponse>("/api/settings/shuttle-routes", {
    cache: "no-store",
    signal,
  });
}

/** 新建一条路线变体；重复的 manifest_id+direction 组合、或 manifest 不是 shuttle 分类都是 400。 */
export function createShuttleRoute(input: {
  manifest_id: number;
  direction: ShuttleDirection;
  label: string;
}): Promise<ShuttleRoute> {
  return apiFetch<ShuttleRoute>("/api/settings/shuttle-routes", {
    method: "POST",
    body: input,
  });
}

/** 只能改 label / sort_order / is_active；manifest_id、direction 建好不可改（传了 400）。 */
export function updateShuttleRoute(
  id: number,
  patch: { label?: string; sort_order?: number; is_active?: boolean },
): Promise<ShuttleRoute> {
  return apiFetch<ShuttleRoute>(`/api/settings/shuttle-routes/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

/**
 * 一条路线变体的 4 个文案字段走 Content Studio 通用的 `tmpl__` 机制（不是另一套接口）：
 * `tmpl__shuttle__{group_name 小写}__{direction}__{field}`。新建路线时后端已经把这 4 个 key
 * 种好（空字符串占位），前端当普通 tmpl__ 字段读写即可。
 */
export function shuttleFieldKey(
  route: Pick<ShuttleRoute, "group_name" | "direction">,
  field: "sms_body" | "email_subject" | "email_body" | "guest_page_body",
): string {
  return `tmpl__shuttle__${route.group_name.toLowerCase()}__${route.direction}__${field}`;
}
