import { apiFetch } from "@/lib/api-client";
import { env } from "@/lib/env";
import {
  ApiError,
  type Vehicle,
  type VehicleColumn,
  type VehicleInput,
  type VehicleLogEntry,
} from "@/types";

/**
 * Settings → Vehicles：车辆池。全部 require_admin。车不能删，只能停用。
 * ⚠️ Samsara 链接就是客人追踪页跳过去的地址；车号写在已发出的追踪链接里，改号会让旧链接看不到地图。
 */
const API = "/api/settings/vehicles";

/** 与后端 services/vehicles.py 一致（只用来限制输入框和写提示）。 */
export const SAMSARA_PREFIX = "https://cloud.samsara.com/";
export const VAN_NO_MAX = 30;
export const NOTES_MAX = 500;
export const COLUMN_LABEL_MAX = 40;
export const CUSTOM_VALUE_MAX = 200;

export async function fetchVehicles(
  signal?: AbortSignal,
): Promise<{ vehicles: Vehicle[]; columns: VehicleColumn[] }> {
  const result = await apiFetch<{
    vehicles: Vehicle[];
    columns?: VehicleColumn[];
  }>(API, { cache: "no-store", signal });
  return {
    vehicles: result.vehicles.map((v) => ({ ...v, custom: v.custom ?? {} })),
    columns: result.columns ?? [],
  };
}

/**
 * Edit all → Save all。**有一台出错就一台都不存**；出错时 400 的 detail 是
 * `{message, errors: {车 id: 原因}}`（用 {@link bulkErrorsOf} 取）。
 */
export async function updateVehicles(
  rows: (VehicleInput & { id: number })[],
): Promise<number> {
  const result = await apiFetch<{ saved: number }>(API, {
    method: "PUT",
    body: { vehicles: rows },
  });
  return result.saved;
}

export function bulkErrorsOf(
  error: unknown,
): { message: string; errors: Record<string, string> } | null {
  if (!(error instanceof ApiError)) return null;
  const d = (error.body as { detail?: unknown } | null)?.detail;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const o = d as { message?: unknown; errors?: unknown };
    return {
      message: typeof o.message === "string" ? o.message : "Nothing was saved.",
      errors:
        o.errors && typeof o.errors === "object"
          ? (o.errors as Record<string, string>)
          : {},
    };
  }
  return null;
}

export async function createVehicleColumn(
  label: string,
): Promise<VehicleColumn> {
  const result = await apiFetch<{ column: VehicleColumn }>(`${API}/columns`, {
    method: "POST",
    body: { label },
  });
  return result.column;
}

/** 改列名 / 隐藏 / 显示（只送要改的那一项）。列不能删。 */
export async function updateVehicleColumn(
  id: number,
  patch: { label?: string; is_hidden?: boolean },
): Promise<void> {
  await apiFetch(`${API}/columns/${id}`, { method: "PUT", body: patch });
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

/**
 * Open map 的地址：旧后台的 `/tracking/vehicle-live?van=`（同旧页面，后端 2026-10-05 samsara-live-share）。
 * 开了 Samsara API 时现建当天有效的临时链接，没开时跳这台车的 samsara_url；要登录旧后台（和 Morning Tracking 的 live_url 同一个入口）。
 * 不直接链 samsara_url：那是永久链接，Samsara 里停掉之后就打不开了。
 */
export function vehicleLiveUrl(vanNo: string): string {
  return `${env.legacyAdminBaseUrl}/tracking/vehicle-live?van=${encodeURIComponent(vanNo.trim())}`;
}

/** 同后端的规整：去头尾、多个空格并一个（用来判断是不是改了车号）。 */
export function normalizeVanNo(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(" ");
}
