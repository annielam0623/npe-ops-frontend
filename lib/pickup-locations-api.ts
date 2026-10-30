import { apiFetch } from "@/lib/api-client";
import type {
  PickupLocation,
  PickupLocationInput,
  ShuttleRoute,
  ShuttleSeason,
} from "@/types";

/**
 * 接客点（酒店）。全部接口 require_admin，staff 调 403。
 * ⚠️ 这里的改动**立刻**影响线上：酒店名 / Aliases 决定订单匹配到哪个接客点（早班、Tour 发送、客人页、语音），
 * Short 进短信，Details 进邮件和客人页。
 */

/** 按酒店名排序，含已停用的。 */
export async function fetchPickupLocations(
  signal?: AbortSignal,
): Promise<PickupLocation[]> {
  const result = await apiFetch<{ locations: PickupLocation[] }>(
    "/api/pickup-locations",
    { cache: "no-store", signal },
  );
  return result.locations;
}

/** 校验失败 400，detail 是给人看的原因（太长、重名、Alias 已属于别的酒店等）。 */
export function createPickupLocation(
  input: PickupLocationInput,
): Promise<{ id: number; hotel_name: string }> {
  return apiFetch("/api/pickup-locations", { method: "POST", body: input });
}

/** 覆盖全部 6 项。 */
export async function updatePickupLocation(
  id: number,
  input: PickupLocationInput,
): Promise<void> {
  await apiFetch(`/api/pickup-locations/${id}`, { method: "PUT", body: input });
}

/** 停用 / 恢复：只影响 Dispatch 的「加酒店」下拉。 */
export async function setPickupLocationActive(
  id: number,
  active: boolean,
): Promise<void> {
  await apiFetch(`/api/pickup-locations/${id}/active`, {
    method: "PATCH",
    body: { active },
  });
}

/** 勾 / 取消「Tour bus departure」：勾了 = 这里上车的客人不进 Morning Relay。admin 才能改，即时生效。 */
export async function setPickupLocationTourDeparture(
  id: number,
  on: boolean,
): Promise<void> {
  await apiFetch(`/api/pickup-locations/${id}/tour-departure`, {
    method: "PATCH",
    body: { tour_departure: on },
  });
}

/** 硬删除。还在 Dispatch 排班里时 409（detail 说明哪几天）。 */
export async function deletePickupLocation(id: number): Promise<void> {
  await apiFetch(`/api/pickup-locations/${id}`, { method: "DELETE" });
}

// ── Shuttle 站的时间 + 季节（preview v3，Annie「就可以动手了」）──────────────────
// 形状照 preview「需要后端」B2 / B3b 暂定，后端定稿后核对。

/** 全站共用的季节，按开始日期排。 */
export async function fetchShuttleSeasons(
  signal?: AbortSignal,
): Promise<ShuttleSeason[]> {
  const r = await apiFetch<{ seasons: ShuttleSeason[] }>(
    "/api/pickup-locations/seasons",
    { cache: "no-store", signal },
  );
  return r.seasons;
}

/** 整份换掉（一个事务）。重叠回 400，detail 是原话。新加的季节不带 id。 */
export async function saveShuttleSeasons(
  seasons: (Omit<ShuttleSeason, "id"> & { id?: number })[],
): Promise<ShuttleSeason[]> {
  const r = await apiFetch<{ seasons: ShuttleSeason[] }>(
    "/api/pickup-locations/seasons",
    { method: "PUT", body: { seasons } },
  );
  return r.seasons;
}

/** Route 下拉：Manifest setup 里的 Shuttle 产品。 */
export async function fetchShuttleRoutes(
  signal?: AbortSignal,
): Promise<ShuttleRoute[]> {
  const r = await apiFetch<{ routes: ShuttleRoute[] }>(
    "/api/pickup-locations/shuttle-routes",
    { cache: "no-store", signal },
  );
  return r.routes;
}
