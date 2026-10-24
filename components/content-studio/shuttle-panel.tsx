"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { fetchManifestSetup } from "@/lib/products-api";
import {
  fetchShuttleProducts,
  type ShuttleProductGroup,
} from "@/lib/shuttle-products-api";

import { ShuttleProductsPanel } from "./shuttle-products-panel";
import { ShuttleRoutesPanel } from "./shuttle-routes-panel";
import type { Studio } from "./studio-cards";

type LoadState =
  | { kind: "loading" }
  /** 新接口还没上线（404 / 405）：回到旧的「路线」面板，线上行为和以前完全一样。 */
  | { kind: "legacy" }
  | { kind: "error"; message: string }
  | { kind: "ready"; groups: ShuttleProductGroup[] };

/**
 * Content Studio → Shuttle。后端 G128 重设计的新接口（`GET /api/settings/shuttle/products`，模板按产品存）
 * 还是草案、没上线。所以这里先试新接口：
 * - 有（200）→ 新的「按产品、颜色 = Group」面板（`ShuttleProductsPanel`）；
 * - 没有（404 / 405）→ 原样显示旧的路线面板（`ShuttleRoutesPanel`），线上不会变坏；
 * - 其它错误 → 红字 + Retry。
 * 不需要特性开关：新接口上线的那一刻起自动换成新面板。
 */
export function ShuttlePanel({
  studio,
  onUnauthorized,
}: {
  studio: Studio;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [colors, setColors] = useState<Record<number, string | null>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const groups = await fetchShuttleProducts(controller.signal);
        if (controller.signal.aborted) return;
        // 颜色认 Products → Manifest setup 的团颜色；Shuttle 接口没带 color 时去那边读（读不到就用灰，不挡页面）。
        if (
          groups.some((g) => g.color === undefined && g.manifest_id != null)
        ) {
          try {
            const setup = await fetchManifestSetup(controller.signal);
            if (controller.signal.aborted) return;
            setColors(
              Object.fromEntries(
                setup.groups.map((g) => [g.id, g.manifest_color]),
              ),
            );
          } catch {
            if (controller.signal.aborted) return;
            setColors({});
          }
        }
        setState({ kind: "ready", groups });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        if (isStatus(error, 404) || isStatus(error, 405)) {
          setState({ kind: "legacy" });
          return;
        }
        setState({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  if (state.kind === "loading") {
    return (
      <p className="py-5 text-[13px] text-[#888] night:text-white/55">
        Loading…
      </p>
    );
  }
  if (state.kind === "legacy") {
    return (
      <ShuttleRoutesPanel studio={studio} onUnauthorized={onUnauthorized} />
    );
  }
  if (state.kind === "error") {
    return (
      <div
        role="alert"
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#fca5a5] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#dc2626] night:border-red-500/30 night:bg-red-500/10 night:text-red-300"
      >
        <span>Could not load Shuttle products: {state.message}</span>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="shrink-0 cursor-pointer rounded-[6px] border border-[#dc2626] px-2.5 py-0.5 text-[11px] font-medium night:border-red-500/30"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <ShuttleProductsPanel
      groups={state.groups}
      colors={colors}
      studio={studio}
    />
  );
}
