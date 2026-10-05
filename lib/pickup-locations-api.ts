import { apiFetch } from "@/lib/api-client";
import type {
  PickupLocation,
  PickupLocationInput,
  PickupLogEntry,
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

export const PICKUP_LOG_LIMIT = 50;

export async function fetchPickupLog(
  signal?: AbortSignal,
): Promise<PickupLogEntry[]> {
  const result = await apiFetch<{ entries: PickupLogEntry[] }>(
    "/api/pickup-locations/log",
    { cache: "no-store", signal, query: { limit: PICKUP_LOG_LIMIT } },
  );
  return result.entries;
}
