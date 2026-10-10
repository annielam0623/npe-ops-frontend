"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DARK_PAGE_CLASS, DarkPanel } from "@/components/ui/dark-page";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  createGuidePlan,
  deleteGuidePlan,
  fetchForecast60Day,
} from "@/lib/forecast-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import type { Forecast60Day, ForecastPlanGuide } from "@/types";

import { CclOtherPanel } from "./ccl-other-panel";
import { ForecastGrid } from "./forecast-grid";
import { GuideEditor } from "./guide-editor";
import { HowToUse } from "./how-to-use";
import { Legend } from "./legend";
import { UnassignedBanner } from "./unassigned-banner";

// 旧版「30 Days Forecast」（单一总数 + 图表）已推翻重做（Annie 2026-10-09）：照 CCL 自己那张调度表的样子，
// 按巴士团路线分块、60 天、Driver / Guide 行可排导游。旧 GET /api/forecast/30-day 还在，这页不再用。
// 旧后台没有这一页，是全新功能，CLAUDE.md 已定的规则：没有旧页面可比对时照本项目已经定下的深色风格做。

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Forecast60Day };

interface EditorTarget {
  manifestId: number;
  /** 这个块自己的 section（空串 = 主块），配 manifestId 才是块的唯一身份。 */
  section: string;
  dayIndex: number;
}

export function ForecastView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [colorByVehicle, setColorByVehicle] = useState(true);
  const [hideZero, setHideZero] = useState(false);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
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

    fetchForecast60Day(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setView({ kind: "ready", data });
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

  function updateCrewGuides(
    manifestId: number,
    section: string,
    dayIndex: number,
    updater: (guides: ForecastPlanGuide[]) => ForecastPlanGuide[],
  ) {
    setView((prev) => {
      if (prev.kind !== "ready") return prev;
      const blocks = prev.data.blocks.map((block) => {
        if (block.manifest_id !== manifestId || block.section !== section)
          return block;
        const crew = block.crew.slice();
        const day = crew[dayIndex];
        if (day.source !== "plan") return block;
        crew[dayIndex] = { source: "plan", guides: updater(day.guides) };
        return { ...block, crew };
      });
      return { ...prev, data: { ...prev.data, blocks } };
    });
  }

  async function handleAdd(
    manifestId: number,
    section: string,
    dayIndex: number,
    runDate: string,
    candidate: { hrId?: number; name?: string },
  ) {
    const result = await createGuidePlan({
      run_date: runDate,
      manifest_id: manifestId,
      section,
      ...(candidate.hrId !== undefined
        ? { guide_hr_id: candidate.hrId }
        : { guide_name: candidate.name! }),
    });
    updateCrewGuides(manifestId, section, dayIndex, (guides) => [
      ...guides,
      {
        id: result.guide.id,
        name: result.guide.name,
        hr_id: result.guide.hr_id,
      },
    ]);
  }

  async function handleRemove(
    manifestId: number,
    section: string,
    dayIndex: number,
    guideId: number,
  ) {
    await deleteGuidePlan(guideId);
    updateCrewGuides(manifestId, section, dayIndex, (guides) =>
      guides.filter((g) => g.id !== guideId),
    );
  }

  const data = view.kind === "ready" ? view.data : null;
  const editorBlock =
    data && editorTarget
      ? data.blocks.find(
          (b) =>
            b.manifest_id === editorTarget.manifestId &&
            b.section === editorTarget.section,
        )
      : null;
  const editorCrewDay =
    editorBlock && editorTarget ? editorBlock.crew[editorTarget.dayIndex] : null;

  return (
    <main className={DARK_PAGE_CLASS}>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-7 sm:px-7">
        <header>
          <span className="text-xs font-medium tracking-[.08em] text-white/45 uppercase">
            Operations
          </span>
          <h1 className="mt-1 text-[28px] leading-[1.1] font-bold tracking-[-.03em] md:text-[34px]">
            60 Days Forecast
          </h1>
          <p className="mt-2 max-w-[640px] text-sm leading-[1.65] text-white/50">
            One block per bus tour route, next 60 days starting today (Los
            Angeles time) — same shape as Canyon Coach Lines&rsquo; own
            dispatch sheet.
          </p>
        </header>

        {view.kind === "loading" ? <DarkPanel>Loading...</DarkPanel> : null}
        {view.kind === "forbidden" ? (
          <DarkPanel>
            <p className="font-semibold">Staff access required</p>
            <p className="mt-1 text-white/60">
              This page is for back-office staff only.
            </p>
          </DarkPanel>
        ) : null}
        {view.kind === "error" ? (
          <ErrorBanner
            dark
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Failed to load the forecast: {view.message}
          </ErrorBanner>
        ) : null}

        {data ? (
          <>
            <UnassignedBanner products={data.unassigned} />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {data.vehicle_tiers.length ? (
                  <label className="inline-flex items-center gap-2 text-white/70">
                    <input
                      type="checkbox"
                      checked={colorByVehicle}
                      onChange={(e) => setColorByVehicle(e.target.checked)}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    Color totals by vehicle
                  </label>
                ) : null}
                <label className="inline-flex items-center gap-2 text-white/70">
                  <input
                    type="checkbox"
                    checked={hideZero}
                    onChange={(e) => setHideZero(e.target.checked)}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                  Hide rows that are all 0
                </label>
              </div>
              {colorByVehicle && data.vehicle_tiers.length ? (
                <Legend tiers={data.vehicle_tiers} />
              ) : null}
            </div>

            <ForecastGrid
              data={data}
              colorByVehicle={colorByVehicle}
              hideZero={hideZero}
              onOpenEditor={(manifestId, section, dayIndex) =>
                setEditorTarget({ manifestId, section, dayIndex })
              }
            />

            <CclOtherPanel cclOther={data.ccl_other} />

            <HowToUse />
          </>
        ) : null}
      </div>

      {editorTarget && editorBlock && editorCrewDay?.source === "plan" ? (
        <GuideEditor
          blockName={editorBlock.name}
          date={data!.days[editorTarget.dayIndex]}
          guides={editorCrewDay.guides}
          guideOptions={data!.guides}
          onAdd={(candidate) =>
            handleAdd(
              editorTarget.manifestId,
              editorTarget.section,
              editorTarget.dayIndex,
              data!.days[editorTarget.dayIndex],
              candidate,
            )
          }
          onRemove={(guideId) =>
            handleRemove(
              editorTarget.manifestId,
              editorTarget.section,
              editorTarget.dayIndex,
              guideId,
            )
          }
          onClose={() => setEditorTarget(null)}
        />
      ) : null}
    </main>
  );
}
