"use client";

import { useCallback, useRef } from "react";

import { ErrorBanner, Panel } from "@/components/ui/panel";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

import type { LoadGate } from "./config";

/**
 * 按钮：蓝色只给提交（Save / Apply），其余白底或深色（Annie 2026-10-11）。
 * 样式取自 Dispatch 的蓝键和 Pickup Locations 的 Add 键 / 小键，保持同一个样子。
 */
export const BTN_BLUE =
  "h-8 cursor-pointer rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 text-[12.5px] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";
/** 列表行里的小号蓝色提交键（团价 Save、改名 Save name；蓝色只给提交键，Annie 2026-10-11 / 2026-10-29「要」）。 */
export const BTN_BLUE_SMALL =
  "h-[30px] cursor-pointer rounded-[7px] border-none bg-[#3b82f6] px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_PLAIN =
  "inline-flex h-8 cursor-pointer items-center rounded-[7px] border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-3 text-[12px] font-medium whitespace-nowrap text-[#1a1a1a] night:text-white/80 hover:bg-[#f5f5f3] night:hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-60";
export const CELL_INPUT =
  "h-7 rounded-[6px] border-[0.5px] border-black/30 night:border-white/10 bg-paper night:bg-white/[.04] px-1.5 text-[12px] text-[#1a1a1a] night:text-white/90 focus:border-[#1a1a1a] night:focus:border-white/40 focus:outline-none disabled:opacity-60";

/** 跳旧后台登录页（401），只跳一次。 */
export function useRedirectToLogin() {
  const done = useRef(false);
  return useCallback(() => {
    if (!done.current) {
      done.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);
}

/** 读取没成功时整页显示的提示；ready / loading 返回 null 由页面自己画。 */
export function GateNotice({
  gate,
  onRetry,
}: {
  gate: LoadGate;
  onRetry: () => void;
}) {
  if (gate.kind === "forbidden") {
    return (
      <Panel>
        <p className="font-medium text-stone-800 night:text-white/90">
          Admin access required
        </p>
        <p className="mt-1">Only admins can change Farm out settings.</p>
      </Panel>
    );
  }
  if (gate.kind === "unavailable") {
    return (
      <Panel>
        <p className="font-medium text-stone-800 night:text-white/90">
          Farm out isn&apos;t available yet
        </p>
        <p className="mt-1">It will show up here once it is switched on.</p>
      </Panel>
    );
  }
  if (gate.kind === "error") {
    return (
      <ErrorBanner actionLabel="Retry" onAction={onRetry}>
        Could not load Farm out: {gate.message}
      </ErrorBanner>
    );
  }
  return null;
}

/** 保存结果的一行小字（成功绿、失败红）。 */
export function ResultLine({
  result,
}: {
  result: { tone: "ok" | "error"; text: string } | null;
}) {
  if (!result) return null;
  return (
    <span
      role={result.tone === "error" ? "alert" : "status"}
      className={cn(
        "text-[12px]",
        result.tone === "ok"
          ? "text-[#3B6D11] night:text-emerald-300"
          : "text-[#A32D2D] night:text-red-300",
      )}
    >
      {result.text}
    </span>
  );
}
