import { apiFetch } from "@/lib/api-client";
import type { ForecastDay } from "@/types";

export function fetchForecast(signal?: AbortSignal): Promise<ForecastDay[]> {
  return apiFetch<ForecastDay[]>("/api/forecast/30-day", {
    cache: "no-store",
    signal,
  });
}
