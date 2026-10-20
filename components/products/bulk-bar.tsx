"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import {
  BULK_APPLY_CLASS,
  BULK_BAR_CLASS,
  BULK_CLEAR_CLASS,
  BULK_HINT_CLASS,
} from "./legacy-ui";

/** 勾了几个以上才出现批量条（Annie 2026-10-19：勾了两个或以上就出现）。勾 1 个仍用每行自己的下拉。 */
export const BULK_MIN = 2;

/**
 * Products 页三处共用的批量条（All Products、Not in this list yet、Manifest setup 的产品列表）。
 * 不固定在页面顶部：作为表格里的一行，贴在页面里最靠下的那个已勾行下面（见 BulkBarRow / lastPickedIndex），
 * 「在勾选的这个区域，不要跑到页面上方去填」（Annie 2026-10-19）。
 */
export function BulkBar({
  count,
  spanned = 1,
  applyLabel = "Apply",
  applyDisabled,
  onApply,
  onClear,
  hint,
  result,
  children,
}: {
  count: number;
  /** 所勾的产品跨了几个组 / 节；大于 1 时在条上写一句。 */
  spanned?: number;
  applyLabel?: string;
  applyDisabled?: boolean;
  onApply: () => void;
  onClear: () => void;
  /** 条上的灰字提示（没选要改的、选法不对时）。 */
  hint?: ReactNode;
  /** 上一次套用的结果（成功几个、失败几个和原因），贴在条下面。 */
  result?: { tone: "ok" | "error"; text: string } | null;
  children: ReactNode;
}) {
  return (
    <div data-bulk-bar>
      <div className={cn(BULK_BAR_CLASS, "rounded-[8px] border-b-0")}>
        <b className="font-semibold">{count} product(s) selected</b>
        {spanned > 1 ? (
          <span className="text-[11px] text-[#f0c870]">
            across {spanned} groups
          </span>
        ) : null}
        {children}
        <button
          type="button"
          disabled={applyDisabled}
          onClick={onApply}
          className={BULK_APPLY_CLASS}
        >
          {applyLabel}
        </button>
        <button type="button" onClick={onClear} className={BULK_CLEAR_CLASS}>
          Clear
        </button>
        {hint ? <span className={BULK_HINT_CLASS}>{hint}</span> : null}
      </div>
      {result ? (
        <BulkResultText result={result} className="px-3 pt-1.5" />
      ) : null}
    </div>
  );
}

/** 上一次批量套用的结果。条在的时候贴在条下面；失败后只剩 1 个勾选、条没了时，单独贴在表格上面。 */
export function BulkResultText({
  result,
  className,
}: {
  result: { tone: "ok" | "error"; text: string };
  className?: string;
}) {
  return (
    <p
      role="status"
      data-bulk-result
      className={cn(
        "text-[12px]",
        result.tone === "error"
          ? "text-[#A32D2D] night:text-red-300"
          : "text-[#3B6D11] night:text-emerald-300",
        className,
      )}
    >
      {result.text}
    </p>
  );
}

/** 表格里放批量条的那一行（跨满所有列）。 */
export function BulkBarRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-2">
        {children}
      </td>
    </tr>
  );
}

/** 按页面里的显示顺序，最后一个已勾行的下标（没有 = -1）。 */
export function lastPickedIndex<T>(
  rows: readonly T[],
  isPicked: (row: T) => boolean,
): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isPicked(rows[i])) return i;
  }
  return -1;
}

/** 失败的写成「3 saved · 1 failed: 名字 — 原因」。 */
export function bulkResultText(
  ok: number,
  failures: { label: string; reason: string }[],
  verb = "saved",
): string {
  if (!failures.length) return `${ok} ${verb}.`;
  return `${ok} ${verb} · ${failures.length} failed: ${failures
    .map((f) => `${f.label} — ${f.reason}`)
    .join("; ")}. The failed ones stay selected; press Apply to retry them.`;
}
