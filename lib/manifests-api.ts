import { apiFetch } from "@/lib/api-client";
import type { ManifestDay } from "@/types";

/**
 * 某一天的 Rezdy 订单（admin only，纯读）。后端：`app/services/manifest_list.py`。
 * 不传 date 时后端按洛杉矶今天，这里总是传——地址栏的 `?date=` 才是唯一的真相来源。
 */
export function fetchManifestDay(
  date: string,
  signal?: AbortSignal,
): Promise<ManifestDay> {
  return apiFetch<ManifestDay>("/api/manifests", {
    cache: "no-store",
    signal,
    query: { date },
  });
}
