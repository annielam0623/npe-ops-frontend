import { apiFetch } from "@/lib/api-client";
import type {
  PromotionDateRange,
  PromotionDetailStatus,
  PromotionStatsDetail,
  PromotionStatsSummary,
} from "@/types";

export const PROMOTION_DETAIL_LIMIT = 500;

export function fetchPromotionSummary(
  range: PromotionDateRange,
  signal?: AbortSignal,
): Promise<PromotionStatsSummary> {
  return apiFetch<PromotionStatsSummary>("/api/promotion-stats/summary", {
    query: { date_from: range.date_from, date_to: range.date_to },
    cache: "no-store",
    signal,
  });
}

export function fetchPromotionDetail(
  status: PromotionDetailStatus,
  range: PromotionDateRange,
  signal?: AbortSignal,
): Promise<PromotionStatsDetail> {
  return apiFetch<PromotionStatsDetail>("/api/promotion-stats/detail", {
    query: { status, date_from: range.date_from, date_to: range.date_to },
    cache: "no-store",
    signal,
  });
}
