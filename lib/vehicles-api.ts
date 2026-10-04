import { apiFetch } from "@/lib/api-client";
import type { Vehicle, VehicleInput, VehicleLogEntry } from "@/types";

/**
 * Settings → Vehicles：车辆池。全部 require_admin。车不能删，只能停用。
 * ⚠️ Samsara 链接就是客人追踪页跳过去的地址；车号写在已发出的追踪链接里，改号会让旧链接看不到地图。
 */
const API = "/api/settings/vehicles";

/** 与后端 services/vehicles.py 一致（只用来限制输入框和写提示）。 */
export const SAMSARA_PREFIX = "https://cloud.samsara.com/";
export const VAN_NO_MAX = 30;
export const NOTES_MAX = 500;

export async function fetchVehicles(signal?: AbortSignal): Promise<Vehicle[]> {
  const result = await apiFetch<{ vehicles: Vehicle[] }>(API, {
    cache: "no-store",
    signal,
  });
  return result.vehicles;
}

export async function fetchVehicleLog(
  signal?: AbortSignal,
): Promise<{ entries: VehicleLogEntry[]; limit: number }> {
  return apiFetch(`${API}/log`, { cache: "no-store", signal });
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const result = await apiFetch<{ vehicle: Vehicle }>(API, {
    method: "POST",
    body: input,
  });
  return result.vehicle;
}

export async function updateVehicle(
  id: number,
  input: VehicleInput,
): Promise<void> {
  await apiFetch(`${API}/${id}`, { method: "PUT", body: input });
}

export async function setVehicleActive(
  id: number,
  active: boolean,
): Promise<void> {
  await apiFetch(`${API}/${id}/active`, {
    method: "PATCH",
    body: { active },
  });
}

/** 同后端的规整：去头尾、多个空格并一个（用来判断是不是改了车号）。 */
export function normalizeVanNo(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(" ");
}
