import { apiFetch } from "@/lib/api-client";
import type {
  CanyonSnapshot,
  Forecast60Day,
  ForecastCellInput,
  ForecastDayAllotmentInput,
  ForecastDayEditResult,
  ForecastDayRunningInput,
  ForecastLogPage,
  ForecastCellResult,
  ForecastGuidePlanInput,
  ForecastGuidePlanResult,
  ForecastSettings,
} from "@/types";

/** GET /api/forecast/60-day，require_staff（所有 staff，不是 admin-only）。 */
export function fetchForecast60Day(
  signal?: AbortSignal,
): Promise<Forecast60Day> {
  return apiFetch<Forecast60Day>("/api/forecast/60-day", {
    cache: "no-store",
    signal,
  });
}

/**
 * 给某天某个团排一个导游。require_staff。400 时 body.detail 是英文原因
 * （过去的日子、CCL 已经发过名单的日子、名字重复、输入不对），describeError() 能直接取到。
 */
export function createGuidePlan(
  input: ForecastGuidePlanInput,
): Promise<ForecastGuidePlanResult> {
  return apiFetch("/api/forecast/guide-plan", { method: "POST", body: input });
}

/** 撤掉一条排班记录（用的是记录自己的 id，不是 hr_id）。 */
export async function deleteGuidePlan(id: number): Promise<void> {
  await apiFetch(`/api/forecast/guide-plan/${id}`, { method: "DELETE" });
}

/**
 * 手写格子（G63：Crew notes、Pax、Driver / Vehicle type、CCL major events）。
 * require_staff；value 空 = 删掉；过去的日子 / 太远的日子 / 链接不是 http(s) 开头时 400，detail 是英文原因。
 */
export function saveForecastCell(
  input: ForecastCellInput,
): Promise<ForecastCellResult> {
  return apiFetch("/api/forecast/cells", { method: "PUT", body: input });
}

/**
 * G81：表上改「这天开不开团」。require_staff；running null = 撤掉手改。
 * 过去的日子 / 超过 400 天 / 原因超长时 400，detail 是英文原因。
 */
export function saveDayRunning(
  input: ForecastDayRunningInput,
): Promise<ForecastDayEditResult> {
  return apiFetch("/api/forecast/day-running", { method: "PUT", body: input });
}

/** G81：表上改这一天某档的上限 / 时间（盖过日期段和平常上限）；max_pax null = 撤掉。 */
export function saveDayAllotment(
  input: ForecastDayAllotmentInput,
): Promise<ForecastDayEditResult> {
  return apiFetch("/api/forecast/day-allotment", {
    method: "PUT",
    body: input,
  });
}

/** G81：Action Log，新的在前；before 是上一页的 next_cursor（原样传回）。 */
export function fetchForecastLog(
  before?: string | null,
  limit = 50,
  signal?: AbortSignal,
): Promise<ForecastLogPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set("before", before);
  return apiFetch<ForecastLogPage>(`/api/forecast/log?${query.toString()}`, {
    cache: "no-store",
    signal,
  });
}

// ── Settings → Products → Bus Manifest setup 里的 Forecast 设置（admin，G63）──

const SETTINGS_API = "/api/settings/forecast";

export function fetchForecastSettings(
  signal?: AbortSignal,
): Promise<ForecastSettings> {
  return apiFetch<ForecastSettings>(SETTINGS_API, {
    cache: "no-store",
    signal,
  });
}

/** 每周开哪几天（0 = 星期一）。7 天全勾 = 后端删掉这一条（天天开）。 */
export function saveRunDays(input: {
  manifest_id: number;
  section: string;
  weekdays: number[];
}): Promise<unknown> {
  return apiFetch(`${SETTINGS_API}/run-days`, { method: "PUT", body: input });
}

export function addClosedDates(input: {
  manifest_id: number;
  section: string;
  date_from: string;
  date_to: string;
  note: string;
}): Promise<{ ok: boolean; id: number }> {
  return apiFetch(`${SETTINGS_API}/closed-dates`, {
    method: "POST",
    body: input,
  });
}

export async function deleteClosedDates(id: number): Promise<void> {
  await apiFetch(`${SETTINGS_API}/closed-dates/${id}`, { method: "DELETE" });
}

/** 一行的平常上限（时间 ≤20 字，人数 1–9999）。 */
export function saveAllotment(input: {
  manifest_id: number;
  row_label: string;
  time_label: string;
  max_pax: number;
}): Promise<unknown> {
  return apiFetch(`${SETTINGS_API}/allotments`, { method: "PUT", body: input });
}

export async function deleteAllotment(
  manifestId: number,
  rowLabel: string,
): Promise<void> {
  const query = new URLSearchParams({
    manifest_id: String(manifestId),
    row_label: rowLabel,
  });
  await apiFetch(`${SETTINGS_API}/allotments?${query.toString()}`, {
    method: "DELETE",
  });
}

/** 某段日子换一个上限；同一行的日期段重叠时 400。 */
export function addAllotmentDates(input: {
  manifest_id: number;
  row_label: string;
  date_from: string;
  date_to: string;
  time_label: string;
  max_pax: number;
}): Promise<{ ok: boolean; id: number }> {
  return apiFetch(`${SETTINGS_API}/allotments/dates`, {
    method: "POST",
    body: input,
  });
}

export async function deleteAllotmentDates(id: number): Promise<void> {
  await apiFetch(`${SETTINGS_API}/allotments/dates/${id}`, {
    method: "DELETE",
  });
}

/** 哪些块在 Forecast 上逐单列订单：整组替换。 */
export function saveOrderDetailBlocks(
  blocks: { manifest_id: number; section: string }[],
): Promise<unknown> {
  return apiFetch(`${SETTINGS_API}/order-detail`, {
    method: "PUT",
    body: { blocks },
  });
}

/** GET /api/forecast/canyon-availability：只读快照，不打 Rezdy，随页面加载调用。后端没上线是 404。 */
export function fetchCanyonSnapshot(
  signal?: AbortSignal,
): Promise<CanyonSnapshot> {
  return apiFetch<CanyonSnapshot>("/api/forecast/canyon-availability", {
    cache: "no-store",
    signal,
  });
}

/** POST /api/forecast/canyon-availability/refresh：向 Rezdy 全量重拉，返回和 GET 一样的新快照；5 秒内重复点后端合并。 */
export function refreshCanyonSnapshot(): Promise<CanyonSnapshot> {
  return apiFetch<CanyonSnapshot>("/api/forecast/canyon-availability/refresh", {
    method: "POST",
    cache: "no-store",
  });
}
