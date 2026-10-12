import { apiFetch } from "@/lib/api-client";
import type {
  Forecast60Day,
  ForecastGuidePlanInput,
  ForecastGuidePlanResult,
} from "@/types";

/** GET /api/forecast/60-day，require_staff（所有 staff，不是 admin-only）。 */
export function fetchForecast60Day(signal?: AbortSignal): Promise<Forecast60Day> {
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
