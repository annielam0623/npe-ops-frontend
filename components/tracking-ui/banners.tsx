import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 三个 tracking 页上 ops 才有的提示条（加载失败 / 没在更新 / 操作失败）。旧页面这些情况是 alert()，
 * 所以没有现成样子：配色取各页自己的色板——早班页深色底，门票 / Tour 页浅色底。
 */
export function TrackingBanner({
  dark = false,
  children,
  actionLabel,
  onAction,
}: {
  dark?: boolean;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "mb-3.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-[13px]",
        dark
          ? "border-[rgba(231,76,60,.40)] bg-[rgba(231,76,60,.14)] text-[#f5a3a3]"
          : "border-[#f5c2c7] bg-[#FCEBEB] text-[#A32D2D]",
      )}
    >
      <span className="min-w-0 break-words">{children}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "cursor-pointer rounded-[7px] border px-3 py-1 text-[12px]",
            dark
              ? "border-white/15 bg-[#1a2f4a] text-[#a0c0e0] hover:bg-[#1e3a5f] hover:text-white"
              : "border-[#dee2e6] bg-white text-[#495057] hover:bg-[#f8f9fa]",
          )}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** 没有权限时整块的说明（ops 才有）。 */
export function TrackingNotice({
  dark = false,
  children,
}: {
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border px-4 py-14 text-center text-[13px]",
        dark
          ? "border-white/[.08] bg-[#1a2f4a] text-[#7a9bbe]"
          : "border-[#dde3ea] bg-white text-[#6c8097]",
      )}
    >
      {children}
    </div>
  );
}
