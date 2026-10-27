"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { fetchManifestSetup } from "@/lib/products-api";
import {
  fetchShuttleProducts,
  type ShuttleProductsData,
} from "@/lib/shuttle-products-api";

import {
  ShuttleRoutesTab,
  ShuttleSharedTab,
  type ShuttleTab,
} from "./shuttle-products-panel";
import { ShuttleRoutesPanel } from "./shuttle-routes-panel";
import type { Studio } from "./studio-cards";

export type ShuttleLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  /** 新接口还没上线（404 / 405）：回到旧的「路线」面板，线上行为和以前完全一样。 */
  | { kind: "legacy" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      data: ShuttleProductsData;
      /** manifest_id → Products 里设的团颜色（没配的不在里面）。 */
      colors: Record<number, string | null>;
    };

/**
 * Content Studio → Shuttle 的数据（`GET /api/settings/shuttle/products`，两层：shared + 每条线）。
 * 放在页面这一层读，因为编辑区和右边 Preview 都要用。enabled = 打开了 Shuttle 模块才读。
 * - 200 → 两层面板；404 / 405 → 旧的路线面板；其它错误 → 红字 + Retry。
 */
export function useShuttleData(enabled: boolean, onUnauthorized: () => void) {
  const [state, setState] = useState<ShuttleLoadState>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const data = await fetchShuttleProducts(controller.signal);
        if (controller.signal.aborted) return;
        let colors: Record<number, string | null> = {};
        // 颜色认 Products → Manifest setup 的团颜色；Shuttle 接口没带 color 时去那边读（读不到就用灰，不挡页面）。
        if (
          data.groups.some(
            (g) => g.color === undefined && g.manifest_id != null,
          )
        ) {
          try {
            const setup = await fetchManifestSetup(controller.signal);
            colors = Object.fromEntries(
              setup.groups.map((g) => [g.id, g.manifest_color]),
            );
          } catch {
            colors = {};
          }
          if (controller.signal.aborted) return;
        }
        setState({ kind: "ready", data, colors });
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
  }, [enabled, reloadKey]);

  return { state, reload: () => setReloadKey((k) => k + 1) };
}

/**
 * GET 时后端才建好的 key（页面打开时读的 template-settings 里可能还没有）和它们的值。
 * 页面拿它补进已存值和草稿（见 content-studio-view.tsx），staff 清空一格就是真的空。
 */
export function shuttleInitialValues(
  data: ShuttleProductsData,
): Record<string, string> {
  return Object.fromEntries([
    ...data.shared.fields.map((f) => [f.key, f.value ?? ""]),
    ...data.shared.text_fields.map((f) => [f.key, f.value ?? ""]),
    ...data.groups.flatMap((g) =>
      g.products.flatMap((p) => p.fields.map((f) => [f.key, f.value ?? ""])),
    ),
  ]) as Record<string, string>;
}

export function ShuttlePanel({
  state,
  onRetry,
  tab,
  studio,
  selected,
  onSelect,
  onUnauthorized,
}: {
  state: ShuttleLoadState;
  onRetry: () => void;
  tab: ShuttleTab;
  studio: Studio;
  selected: string | null;
  onSelect: (code: string) => void;
  onUnauthorized: () => void;
}) {
  if (state.kind === "idle" || state.kind === "loading") {
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
        <span>Could not load Shuttle text: {state.message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 cursor-pointer rounded-[6px] border border-[#dc2626] px-2.5 py-0.5 text-[11px] font-medium night:border-red-500/30"
        >
          Retry
        </button>
      </div>
    );
  }
  return tab === "Routes" ? (
    <ShuttleRoutesTab
      groups={state.data.groups}
      colors={state.colors}
      studio={studio}
      selected={selected}
      onSelect={onSelect}
    />
  ) : (
    <ShuttleSharedTab tab={tab} data={state.data} studio={studio} />
  );
}
