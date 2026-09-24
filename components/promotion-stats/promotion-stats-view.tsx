"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchPromotionDetail,
  fetchPromotionSummary,
} from "@/lib/promotion-stats-api";
import { buildLoginHref } from "@/lib/safe-redirect";
import {
  ApiError,
  type PromotionDateRange,
  type PromotionDetailStatus,
  type PromotionStatsDetail,
  type PromotionStatsSummary,
} from "@/types";

import { TABLE_TITLES } from "./config";
import { DateRangeFilter, type DateRangeValue } from "./date-range-filter";
import { DetailTable } from "./detail-table";
import { RetryButton } from "./retry-button";
import { StatCards } from "./stat-cards";

interface RequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_RANGE: DateRangeValue = { from: "", to: "" };

function toQueryRange(from: string, to: string): PromotionDateRange {
  return { date_from: from || undefined, date_to: to || undefined };
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `请求失败（${error.status}${error.statusText ? ` ${error.statusText}` : ""}）`;
  }
  if (error instanceof TypeError) {
    return "无法连接后端服务，请检查网络后重试。";
  }
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

export function PromotionStatsView() {
  const router = useRouter();

  const [draftRange, setDraftRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [appliedRange, setAppliedRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [status, setStatus] = useState<PromotionDetailStatus>("all");
  // 递增即强制重新请求，保证日期本来就为空时 Clear / Apply / Retry 也会重新拉取。
  const [reloadKey, setReloadKey] = useState(0);

  const [summary, setSummary] = useState<RequestState<PromotionStatsSummary>>({
    data: null,
    loading: true,
    error: null,
  });
  const [detail, setDetail] = useState<RequestState<PromotionStatsDetail>>({
    data: null,
    loading: true,
    error: null,
  });

  const redirectingRef = useRef(false);

  const handleRequestError = useCallback(
    (error: unknown, signal: AbortSignal): string | null => {
      if (signal.aborted) {
        return null;
      }
      if (error instanceof ApiError && error.status === 401) {
        if (!redirectingRef.current) {
          redirectingRef.current = true;
          const { pathname, search } = window.location;
          router.replace(buildLoginHref(`${pathname}${search}`));
        }
        return null;
      }
      return describeError(error);
    },
    [router],
  );

  const { from, to } = appliedRange;

  useEffect(() => {
    const controller = new AbortController();
    setSummary((prev) => ({ ...prev, loading: true, error: null }));

    fetchPromotionSummary(toQueryRange(from, to), controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setSummary({ data, loading: false, error: null });
        }
      },
      (error: unknown) => {
        const message = handleRequestError(error, controller.signal);
        if (message !== null) {
          setSummary({ data: null, loading: false, error: message });
        }
      },
    );

    return () => controller.abort();
  }, [from, to, reloadKey, handleRequestError]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail((prev) => ({ ...prev, loading: true, error: null }));

    fetchPromotionDetail(
      status,
      toQueryRange(from, to),
      controller.signal,
    ).then(
      (data) => {
        if (!controller.signal.aborted) {
          setDetail({ data, loading: false, error: null });
        }
      },
      (error: unknown) => {
        const message = handleRequestError(error, controller.signal);
        if (message !== null) {
          setDetail({ data: null, loading: false, error: message });
        }
      },
    );

    return () => controller.abort();
  }, [status, from, to, reloadKey, handleRequestError]);

  function handleApply() {
    if (draftRange.from && draftRange.to && draftRange.from > draftRange.to) {
      setRangeError("开始日期不能晚于结束日期。");
      return;
    }
    setRangeError(null);
    setAppliedRange(draftRange);
    setReloadKey((key) => key + 1);
  }

  function handleClear() {
    setRangeError(null);
    setDraftRange(EMPTY_RANGE);
    setAppliedRange(EMPTY_RANGE);
    setStatus("all");
    setReloadKey((key) => key + 1);
  }

  function handleRetry() {
    setReloadKey((key) => key + 1);
  }

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Operations
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">
            Promotion Stats
          </h1>
        </header>

        <DateRangeFilter
          value={draftRange}
          error={rangeError}
          onChange={setDraftRange}
          onApply={handleApply}
          onClear={handleClear}
        />

        {summary.error ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-2.5 text-sm text-[#A32D2D]">
            <span>统计数据加载失败：{summary.error}</span>
            <RetryButton onClick={handleRetry} />
          </div>
        ) : null}

        <StatCards
          summary={summary.data}
          loading={summary.loading}
          activeFilter={status}
          onSelectFilter={setStatus}
        />

        <DetailTable
          title={TABLE_TITLES[status]}
          records={detail.data}
          loading={detail.loading}
          error={detail.error}
          onRetry={handleRetry}
        />
      </div>
    </main>
  );
}
