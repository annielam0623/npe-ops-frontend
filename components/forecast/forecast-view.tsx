"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DARK_PAGE_CLASS, DarkPanel } from "@/components/ui/dark-page";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { downloadCsv } from "@/lib/csv";
import { fetchForecast } from "@/lib/forecast-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { ForecastDay } from "@/types";

import { formatLong, formatShort, formatWeekday, summarize } from "./config";
import { ForecastChart } from "./forecast-chart";

// 旧后台没有这一页（侧栏一直是「Coming soon」占位），这是全新功能。
// CLAUDE.md 已定的规则：旧页面没有对应实现时照 dashboard 已经定下的深色风格做，不自己另开一套。

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; days: ForecastDay[] };

export function ForecastView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setView({ kind: "loading" });

    fetchForecast(controller.signal).then(
      (days) => {
        if (!controller.signal.aborted) {
          setView({ kind: "ready", days });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          redirectToLogin();
        } else if (isStatus(error, 403)) {
          setView({ kind: "forbidden" });
        } else {
          setView({ kind: "error", message: describeError(error) });
        }
      },
    );

    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  return (
    <main className={DARK_PAGE_CLASS}>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-7 sm:px-7">
        <header>
          <span className="text-xs font-medium tracking-[.08em] text-white/45 uppercase">
            Operations
          </span>
          <h1 className="mt-1 text-[28px] leading-[1.1] font-bold tracking-[-.03em] md:text-[34px]">
            30 Days Forecast
          </h1>
          <p className="mt-2 max-w-[560px] text-sm leading-[1.65] text-white/50">
            Total guest count booked for each of the next 30 days, starting
            today (Los Angeles time).
          </p>
        </header>

        <ForecastBody
          view={view}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    </main>
  );
}

function ForecastBody({
  view,
  onRetry,
}: {
  view: ViewState;
  onRetry: () => void;
}) {
  switch (view.kind) {
    case "loading":
      return <DarkPanel>Loading...</DarkPanel>;
    case "forbidden":
      return (
        <DarkPanel>
          <p className="font-semibold">Staff access required</p>
          <p className="mt-1 text-white/60">
            This page is for back-office staff only.
          </p>
        </DarkPanel>
      );
    case "error":
      return (
        <ErrorBanner dark actionLabel="Retry" onAction={onRetry}>
          Failed to load the forecast: {view.message}
        </ErrorBanner>
      );
    case "ready":
      return <ForecastReady days={view.days} onRefresh={onRetry} />;
  }
}

function ForecastReady({
  days,
  onRefresh,
}: {
  days: ForecastDay[];
  onRefresh: () => void;
}) {
  const stats = summarize(days);
  const peak = stats.peakIndex >= 0 ? days[stats.peakIndex] : null;

  function exportCsv() {
    downloadCsv(
      `forecast_30day_${days[0]?.date ?? "export"}.csv`,
      ["Date", "Weekday", "Pax"],
      days.map((d) => [d.date, formatWeekday(d.date), d.pax]),
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Total pax, next 30 days"
          value={stats.total.toLocaleString()}
        />
        <StatTile
          label="Daily average"
          value={stats.average.toLocaleString()}
        />
        <StatTile
          label="Busiest day"
          value={peak ? peak.pax.toLocaleString() : "—"}
          detail={peak ? formatShort(peak.date) : undefined}
        />
      </div>

      <DarkPanel>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white/80">
            Pax by day, {formatShort(days[0].date)} –{" "}
            {formatShort(days[days.length - 1].date)}
          </h2>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs font-medium text-white/50 hover:text-white"
          >
            ↻ Refresh
          </button>
        </div>
        <ForecastChart days={days} peakIndex={stats.peakIndex} />
      </DarkPanel>

      <DarkPanel>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white/80">
            Day by day
          </h2>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md border border-white/15 px-2.5 py-1 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white"
          >
            ⬇ Export
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto rounded-lg border border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-[#0b1626]">
              <tr className="text-left text-[11px] font-semibold tracking-wide text-white/45 uppercase">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Pax</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr
                  key={d.date}
                  className={cn(
                    "border-t border-white/5",
                    i === 0 && "bg-sky-400/10",
                  )}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className={cn(i === 0 && "font-semibold text-white")}>
                      {formatLong(d.date)}
                    </span>
                    {i === 0 ? (
                      <span className="ml-2 rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                        Today
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {d.pax.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DarkPanel>
    </>
  );
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[.032] p-[18px]">
      <div className="text-xs text-white/50">{label}</div>
      <div className="mt-1 text-[26px] leading-none font-semibold">
        {value}
        {detail ? (
          <span className="ml-2 text-sm font-normal text-white/50">
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
