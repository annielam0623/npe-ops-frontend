"use client";

import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchManifestCards } from "@/lib/dispatch-manifest-api";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { resolveTourColor } from "@/lib/tour-colors";
import { replaceUrl } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { ManifestCard } from "@/types";

import { enterFullscreen, VIEW_ONLY_HOW_TO, VIEW_PARAM } from "./paper-view";

/**
 * Operations ›「Bus Manifests」入口页（151 题 ⑧ A，Annie 2026-11-16「全部同意推荐」「动手」）：
 * 换日期（‹ 今天 ›），当天每个团一行、每台车一个键，点车直接进那台车的 View only（全屏打印纸样）。
 * 用 Dispatch Step 1 团卡片读的同一个接口（GET /api/dispatch/manifests），不加新接口、不加开关；
 * 能开 Dispatch（dispatch.view）的人都看得到（题 ⑦ B）。点车时先请求真全屏（这一下点击里），再跳到 Bus Manifest。
 */

const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAY.format(new Date(Date.UTC(y, m - 1, d)));
}

const DAY_BTN =
  "inline-flex h-[30px] cursor-pointer items-center justify-center rounded-[8px] border border-white/25 bg-transparent px-3 text-[13px] font-semibold text-white/90 hover:bg-white/[.07]";
const BUS_BTN =
  "inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-black/25 bg-paper px-3 text-[12.5px] font-bold whitespace-nowrap text-[#111] hover:bg-[#f1f3f6]";

/** 这一团的车（字母），按字母排；名单还没分车时按车数补 A、B…。 */
function busKeys(c: ManifestCard): string[] {
  const keys = Object.keys(c.bus_pax ?? {}).filter(Boolean);
  if (keys.length) return keys.sort();
  return Array.from({ length: c.buses }, (_, i) => String.fromCharCode(65 + i));
}

export function BusManifestsView() {
  const router = useRouter();
  const [date, setDate] = useState<string | null>(null);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "forbidden" }
    | { kind: "ready"; cards: ManifestCard[] }
  >({ kind: "loading" });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("date");
    setDate(isYmd(q) ? q : laToday());
  }, []);

  const load = useCallback((d: string, signal?: AbortSignal) => {
    setState({ kind: "loading" });
    fetchManifestCards(d, signal)
      .then(({ cards }) => setState({ kind: "ready", cards }))
      .catch((e) => {
        if (signal?.aborted) return;
        if (isStatus(e, 401))
          window.location.href = buildLegacyLoginRedirectUrl(
            window.location.href,
          );
        else if (isStatus(e, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(e) });
      });
  }, []);

  useEffect(() => {
    if (!date) return;
    const c = new AbortController();
    load(date, c.signal);
    return () => c.abort();
  }, [date, load]);

  function go(d: string) {
    setDate(d);
    const url = new URL(window.location.href);
    url.searchParams.set("date", d);
    replaceUrl(url);
  }

  function open(card: ManifestCard, key: string) {
    enterFullscreen();
    router.push(
      `/dispatch/manifest?date=${date}&tour=${card.manifest_id}&${VIEW_PARAM}=${encodeURIComponent(key)}`,
    );
  }

  return (
    <div data-bus-manifests className="mx-auto max-w-[900px]">
      <h1 className="m-0 text-[28px] leading-[1.15] font-bold text-white/90 max-sm:text-[24px]">
        Bus Manifests
      </h1>
      {date ? (
        <div className="mt-3 mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Previous day"
            data-bm-prev
            className={DAY_BTN}
            onClick={() => go(shiftYmd(date, -1))}
          >
            ‹
          </button>
          <b className="text-[15px] text-white/90" data-bm-date>
            {longDate(date)}
          </b>
          <button
            type="button"
            aria-label="Next day"
            data-bm-next
            className={DAY_BTN}
            onClick={() => go(shiftYmd(date, 1))}
          >
            ›
          </button>
          {date !== laToday() ? (
            <button
              type="button"
              data-bm-today
              className={DAY_BTN}
              onClick={() => go(laToday())}
            >
              Today
            </button>
          ) : null}
        </div>
      ) : null}

      {state.kind === "forbidden" ? (
        <ErrorBanner>
          Your account can’t open Dispatch. Ask an admin to give you Dispatch on
          the Team page.
        </ErrorBanner>
      ) : state.kind === "error" ? (
        <ErrorBanner
          actionLabel="Try again"
          onAction={() => date && load(date)}
        >
          Could not load the Bus Manifests: {state.message}
        </ErrorBanner>
      ) : state.kind === "loading" ? (
        <p className="py-10 text-center text-[13px] text-white/55">Loading…</p>
      ) : state.cards.length === 0 ? (
        <p
          data-bm-empty
          className="rounded-[10px] bg-paper px-4 py-6 text-center text-[13px] text-[#4b5563]"
        >
          No tours on this day.
        </p>
      ) : (
        <div className="grid gap-2.5">
          {state.cards.map((c) => {
            const keys = busKeys(c);
            const ready = c.uploaded && c.buses > 0;
            return (
              <div
                key={c.manifest_id}
                data-bm-tour={c.manifest_id}
                style={
                  {
                    "--c": resolveTourColor(null, c.name || c.title),
                  } as CSSProperties
                }
                className="grid gap-2 rounded-[10px] border-l-[5px] border-l-[var(--c)] bg-paper px-4 py-3 text-[#111827]"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <b className="text-[15px]">{c.title}</b>
                  {c.uploaded ? (
                    <span className="text-[12.5px] text-[#4b5563]">
                      {c.buses} bus{c.buses === 1 ? "" : "es"} · {c.pax ?? 0}{" "}
                      pax
                    </span>
                  ) : null}
                </div>
                {ready ? (
                  <div className="flex flex-wrap gap-2">
                    {keys.length > 1 ? (
                      <button
                        type="button"
                        data-bm-open={`${c.manifest_id}|all`}
                        className={BUS_BTN}
                        onClick={() => open(c, "all")}
                      >
                        All buses
                      </button>
                    ) : null}
                    {keys.map((k) => (
                      <button
                        key={k}
                        type="button"
                        data-bm-open={`${c.manifest_id}|${k}`}
                        className={BUS_BTN}
                        onClick={() => open(c, k)}
                      >
                        Bus {k}
                        {c.bus_pax?.[k] !== undefined ? (
                          <span className="font-normal text-[#4b5563]">
                            · {c.bus_pax[k]} pax
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span
                    className={cn("text-[12.5px] text-[#4b5563]")}
                    data-bm-not-ready
                  >
                    {c.uploaded ? "No bus assigned yet." : "No guests yet."}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <HowToUse
        title="How to use — Bus Manifests"
        items={[
          "Bus Manifests in the side menu lists each day's tours and buses. Pick a bus to open it in View only.",
          ...VIEW_ONLY_HOW_TO,
        ]}
      />
    </div>
  );
}
