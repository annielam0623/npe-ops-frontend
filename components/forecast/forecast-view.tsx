"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DarkPanel, plex } from "@/components/ui/dark-page";
import { ErrorBanner } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  createGuidePlan,
  deleteGuidePlan,
  fetchCanyonSnapshot,
  fetchForecast60Day,
  refreshCanyonSnapshot,
  saveDayAllotment,
  saveDayRunning,
  saveForecastCell,
} from "@/lib/forecast-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import type {
  CanyonSnapshot,
  Forecast60Day,
  ForecastBlock,
  ForecastCellMeta,
  ForecastCellResult,
  ForecastPlanGuide,
} from "@/types";

import { ActionLog } from "./action-log";
import { CclOtherPanel } from "./ccl-other-panel";
import { CellEditor } from "./cell-editor";
import {
  allotmentAbbreviations,
  closedReason,
  formatLongDate,
  formatMetaTime,
  isClosedDay,
} from "./config";
import {
  DayAllotmentEditor,
  type AllotmentChange,
} from "./day-allotment-editor";
import { DayRunningEditor } from "./day-running-editor";
import { ForecastGrid, type CellTarget } from "./forecast-grid";
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

/** 存格子的结果 ⇒ 页头 Updated by；清空时后端不给时间（null），返回 null 表示不改。 */
function changedBy(
  result: ForecastCellResult,
): { name: string; at: string } | null {
  return result.updated_at
    ? { name: result.updated_by, at: result.updated_at }
    : null;
}

/** 快照时间显示成洛杉矶时间，例 "5:00 AM"（不是今天就带日期）。 */
function formatCanyonTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const la = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      ...opts,
    }).format(d);
  const time = la({ hour: "numeric", minute: "2-digit" });
  const sameDay =
    la({ year: "numeric", month: "numeric", day: "numeric" }) ===
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(new Date());
  return sameDay ? time : `${la({ month: "short", day: "numeric" })}, ${time}`;
}

export function ForecastView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [colorByVehicle, setColorByVehicle] = useState(true);
  const [hideZero, setHideZero] = useState(false);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [cellTarget, setCellTarget] = useState<CellTarget | null>(null);
  // G81：点粗体人数格 / Max allotments 格（只存块的身份和第几天，数据永远从最新的 view 里取）。
  const [runningTarget, setRunningTarget] = useState<EditorTarget | null>(null);
  const [allotTarget, setAllotTarget] = useState<EditorTarget | null>(null);
  // 表上存了一处就 +1：Action Log 展开着就重拉。
  const [logKey, setLogKey] = useState(0);
  // Antelope 剩余座位快照（后端 bbff78d）：null = 后端没上线 / 读失败 ⇒ 那一行照旧。页面打开只读快照，不触发 Rezdy。
  const [canyon, setCanyon] = useState<CanyonSnapshot | null>(null);
  const [canyonBusy, setCanyonBusy] = useState(false);
  const [canyonError, setCanyonError] = useState<string | null>(null);
  // 全屏（Annie 2026-10-13）：整页（含编辑框）进浏览器全屏；浏览器不支持（例如 iPhone Safari）就不显示这个键。
  const mainRef = useRef<HTMLElement>(null);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === mainRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void mainRef.current?.requestFullscreen().catch(() => {});
    }
  }
  const redirectingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCanyonSnapshot(controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted) setCanyon(snapshot);
      },
      () => {
        // 404（后端没上线）或其它读失败：不影响整页，那一行照旧显示 Max allotments。
      },
    );
    return () => controller.abort();
  }, [reloadKey]);

  /** Refresh：向 Rezdy 重拉（后端 5 秒内重复点合并），再把 60-day 也重拉，销售数跟着最新。失败原话显示在页头，旧数字保留。 */
  async function handleRefreshCanyon() {
    if (canyonBusy) return;
    setCanyonBusy(true);
    setCanyonError(null);
    try {
      const snapshot = await refreshCanyonSnapshot();
      setCanyon(snapshot);
      await refreshQuietly();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
      } else {
        setCanyonError(describeError(error));
      }
    } finally {
      setCanyonBusy(false);
    }
  }

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

  /** 表上改了开关团 / 上限后重拉整张表（总数、剩几位、小黄点都会变），不闪 Loading。 */
  async function refreshQuietly() {
    try {
      const data = await fetchForecast60Day();
      setView((prev) =>
        prev.kind === "ready" ? { kind: "ready", data } : prev,
      );
    } catch {
      // 存已经成功了；重拉失败就保留现在的表，staff 刷新页面即可。
    }
    setLogKey((k) => k + 1);
  }

  async function handleSaveRunning(
    target: EditorTarget,
    date: string,
    running: boolean | null,
    reason: string,
  ) {
    try {
      await saveDayRunning({
        date,
        manifest_id: target.manifestId,
        section: target.section,
        running,
        reason,
      });
    } finally {
      // 400 / 409 之类说明别人刚改过：也重拉，让页面跟后端一致。
      await refreshQuietly();
    }
  }

  async function handleSaveAllotments(
    target: EditorTarget,
    date: string,
    changes: AllotmentChange[],
  ) {
    try {
      // 一档一档存；中途出错就停在那一档，前面存好的下面 finally 里重拉就看得到。
      for (const change of changes) {
        await saveDayAllotment({
          date,
          manifest_id: target.manifestId,
          row_label: change.rowLabel,
          time_label: change.timeLabel,
          max_pax: change.maxPax,
        });
      }
    } finally {
      await refreshQuietly();
    }
  }

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

  /**
   * 存成功后把格子、谁改的、页头 Updated by 就地改掉（不整页重拉）。
   * 清空（删掉）时后端回的 updated_at 是 null：格子的「谁写的」去掉，页头 Updated by 不动。
   */
  function applyCellResult(target: CellTarget, result: ForecastCellResult) {
    const meta: ForecastCellMeta | null =
      result.value && result.updated_at
        ? { updated_by: result.updated_by, updated_at: result.updated_at }
        : null;
    const put = <T,>(values: T[] | undefined, value: T, length: number) => {
      const next = values ? values.slice() : Array<T | undefined>(length);
      next[target.dayIndex] = value;
      return next as T[];
    };
    setView((prev) => {
      if (prev.kind !== "ready") return prev;
      const length = prev.data.days.length;
      const updatedBy = changedBy(result) ?? prev.data.updated_by;
      if (target.rowKey === "major_events") {
        return {
          ...prev,
          data: {
            ...prev.data,
            updated_by: updatedBy,
            page_cells: {
              ...prev.data.page_cells,
              major_events: put(
                prev.data.page_cells?.major_events,
                result.value,
                length,
              ),
            },
            page_cells_meta: {
              ...prev.data.page_cells_meta,
              major_events: put(
                prev.data.page_cells_meta?.major_events,
                meta,
                length,
              ),
            },
          },
        };
      }
      const key = target.rowKey;
      const blocks = prev.data.blocks.map((block) =>
        block.manifest_id === target.manifestId &&
        block.section === target.section
          ? {
              ...block,
              cells: {
                ...block.cells,
                [key]: put(block.cells?.[key], result.value, length),
              },
              cells_meta: {
                ...block.cells_meta,
                [key]: put(block.cells_meta?.[key], meta, length),
              },
            }
          : block,
      );
      return {
        ...prev,
        data: { ...prev.data, updated_by: updatedBy, blocks },
      };
    });
  }

  async function handleSaveCell(
    target: CellTarget,
    date: string,
    value: string,
  ) {
    const result = await saveForecastCell({
      row_key: target.rowKey,
      date,
      ...(target.manifestId !== undefined
        ? { manifest_id: target.manifestId, section: target.section }
        : {}),
      value,
    });
    applyCellResult(target, result);
  }

  const data = view.kind === "ready" ? view.data : null;
  const cellValueNow =
    data && cellTarget
      ? cellTarget.rowKey === "major_events"
        ? (data.page_cells?.major_events?.[cellTarget.dayIndex] ?? "")
        : (data.blocks.find(
            (b) =>
              b.manifest_id === cellTarget.manifestId &&
              b.section === cellTarget.section,
          )?.cells?.[cellTarget.rowKey]?.[cellTarget.dayIndex] ?? "")
      : "";
  const findBlock = (t: EditorTarget | null): ForecastBlock | null =>
    data && t
      ? (data.blocks.find(
          (b) => b.manifest_id === t.manifestId && b.section === t.section,
        ) ?? null)
      : null;
  const runningBlock = findBlock(runningTarget);
  const allotBlock = findBlock(allotTarget);
  const editorBlock =
    data && editorTarget
      ? data.blocks.find(
          (b) =>
            b.manifest_id === editorTarget.manifestId &&
            b.section === editorTarget.section,
        )
      : null;
  const editorCrewDay =
    editorBlock && editorTarget
      ? editorBlock.crew[editorTarget.dayIndex]
      : null;

  return (
    // 深色底、四周留白由整站外框给（同 dashboard，链尾 06e636a 的做法），这里只要字体。
    // 全屏时外框不在了：自己给深色底、留白和上下滚动。
    <main
      ref={mainRef}
      className={cn(
        plex.className,
        "text-[#f8fafc] [&:fullscreen]:overflow-y-auto [&:fullscreen]:bg-[#06101c] [&:fullscreen]:p-6",
      )}
    >
      <div className="relative flex flex-col gap-6">
        <header>
          <span className="text-xs font-medium tracking-[.08em] text-white uppercase max-sm:hidden">
            Operations
          </span>
          {/* 手机版（Annie 2026-10-16）：标题 + 右上角 Refresh（就是 Antelope seats 那个 Refresh，下面绝对定位到这里）→ 颜色说明 → 表格；其余选项收起。 */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="mt-1 text-[28px] leading-[1.1] font-bold tracking-[-.03em] max-sm:mt-0 md:text-[34px]">
              7 Days Forecast
            </h1>
          </div>
          {/* 不限宽：一行放得下就不折（Annie 2026-10-13，全站页头说明同一规矩）。 */}
          <p className="mt-2 text-sm leading-[1.65] text-white max-sm:hidden">
            One block per bus tour route, next 60 days starting today (Los
            Angeles time) — same shape as Canyon Coach Lines&rsquo; own dispatch
            sheet.
          </p>
        </header>

        {view.kind === "loading" ? <DarkPanel>Loading...</DarkPanel> : null}
        {view.kind === "forbidden" ? (
          <DarkPanel>
            <p className="font-semibold">Staff access required</p>
            <p className="mt-1 text-white">
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
            {data.updated_by ? (
              // CCL 表顶上的 Updated by（G63）：最后一个改手写格子的人。
              <div className="-mt-3 text-[12.5px] text-[#cbd5e1] max-sm:hidden">
                <span data-updated-by className="text-white">
                  Updated by {data.updated_by.name} ·{" "}
                  {formatMetaTime(data.updated_by.at)}
                </span>
              </div>
            ) : null}

            {canyon ? (
              <div
                data-canyon-bar
                className="-mt-1 flex flex-wrap items-center gap-3 text-[12.5px] text-white max-sm:contents"
              >
                <span data-canyon-updated className="max-sm:hidden">
                  Antelope seats:{" "}
                  {canyon.never_synced || !canyon.as_of
                    ? "not synced yet"
                    : `updated ${formatCanyonTime(canyon.as_of)}`}{" "}
                  · estimate
                </span>
                <button
                  type="button"
                  data-canyon-refresh
                  onClick={handleRefreshCanyon}
                  disabled={canyonBusy}
                  className="cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60 max-sm:absolute max-sm:top-0 max-sm:right-0"
                >
                  {canyonBusy ? "Refreshing…" : "Refresh"}
                </button>
                {canyonError ? (
                  <span
                    role="alert"
                    data-canyon-error
                    className="text-[#fca5a5]"
                  >
                    {canyonError}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              {colorByVehicle && data.vehicle_tiers.length ? (
                <Legend tiers={data.vehicle_tiers} />
              ) : null}
              {/* 颜色说明在左、两个选项在右（Annie 2026-10-13 要求对调）；ml-auto：颜色说明不显示时选项也靠右。 */}
              <div className="ml-auto flex flex-wrap items-center gap-4 text-sm max-sm:hidden">
                {data.vehicle_tiers.length ? (
                  <label className="inline-flex items-center gap-2 text-white">
                    <input
                      type="checkbox"
                      checked={colorByVehicle}
                      onChange={(e) => setColorByVehicle(e.target.checked)}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    Color totals by vehicle
                  </label>
                ) : null}
                <label className="inline-flex items-center gap-2 text-white">
                  <input
                    type="checkbox"
                    checked={hideZero}
                    onChange={(e) => setHideZero(e.target.checked)}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                  Hide rows that are all 0
                </label>
                {canFullscreen ? (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1 text-white hover:bg-white/10 hover:text-white"
                  >
                    <span aria-hidden>{isFullscreen ? "✕" : "⛶"}</span>
                    {isFullscreen ? "Exit full screen" : "Full screen"}
                  </button>
                ) : null}
              </div>
            </div>

            <ForecastGrid
              data={data}
              colorByVehicle={colorByVehicle}
              hideZero={hideZero}
              canyon={canyon}
              onOpenEditor={(manifestId, section, dayIndex) =>
                setEditorTarget({ manifestId, section, dayIndex })
              }
              onOpenCell={setCellTarget}
              onOpenRunning={(block, dayIndex) =>
                setRunningTarget({
                  manifestId: block.manifest_id,
                  section: block.section,
                  dayIndex,
                })
              }
              onOpenAllotment={(block, dayIndex) =>
                setAllotTarget({
                  manifestId: block.manifest_id,
                  section: block.section,
                  dayIndex,
                })
              }
            />

            {/* 接口没带 running_meta（后端 G81 没上线）时不显示，免得展开只得到 Not Found。 */}
            {data.blocks.some((b) => b.running_meta !== undefined) ? (
              <ActionLog refreshKey={logKey} />
            ) : null}

            <CclOtherPanel cclOther={data.ccl_other} />

            <HowToUse />

            {/* 没归组的产品放最下面（Annie 2026-10-13）：看 Forecast 的人不用管；后端 G51 已每 15 分钟发邮件给 azhou@ / lxu@。 */}
            <UnassignedBanner products={data.unassigned} />
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

      {data && cellTarget ? (
        <CellEditor
          key={`${cellTarget.rowKey}:${cellTarget.manifestId ?? ""}:${cellTarget.section}:${cellTarget.dayIndex}`}
          title={`${cellTarget.label} · ${cellTarget.title}`}
          subtitle={formatLongDate(data.days[cellTarget.dayIndex])}
          initialValue={cellValueNow}
          multiline
          hint="Up to 500 characters. Clear it and Save to remove the note."
          onSave={(value) =>
            handleSaveCell(cellTarget, data.days[cellTarget.dayIndex], value)
          }
          onClose={() => setCellTarget(null)}
        />
      ) : null}

      {data && runningTarget && runningBlock ? (
        <DayRunningEditor
          key={`${runningTarget.manifestId}:${runningTarget.section}:${runningTarget.dayIndex}`}
          title={runningBlock.name}
          subtitle={formatLongDate(data.days[runningTarget.dayIndex])}
          closed={isClosedDay(runningBlock, runningTarget.dayIndex)}
          reason={closedReason(runningBlock, runningTarget.dayIndex)}
          meta={runningBlock.running_meta?.[runningTarget.dayIndex] ?? null}
          cclClosed={(() => {
            const crew = runningBlock.crew[runningTarget.dayIndex];
            return crew?.source === "ccl" && crew.closed;
          })()}
          onSave={(running, reason) =>
            handleSaveRunning(
              runningTarget,
              data.days[runningTarget.dayIndex],
              running,
              reason,
            )
          }
          onClose={() => setRunningTarget(null)}
        />
      ) : null}

      {data && allotTarget && allotBlock?.allotments ? (
        <DayAllotmentEditor
          key={`${allotTarget.manifestId}:${allotTarget.section}:${allotTarget.dayIndex}`}
          title={`Max allotments · ${allotBlock.name}`}
          subtitle={formatLongDate(data.days[allotTarget.dayIndex])}
          allotments={allotBlock.allotments}
          dayIndex={allotTarget.dayIndex}
          abbreviations={allotmentAbbreviations(allotBlock.allotments)}
          onSave={(changes) =>
            handleSaveAllotments(
              allotTarget,
              data.days[allotTarget.dayIndex],
              changes,
            )
          }
          onClose={() => setAllotTarget(null)}
        />
      ) : null}
    </main>
  );
}
