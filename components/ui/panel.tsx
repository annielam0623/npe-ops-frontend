import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { DARK_SECONDARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";

/** 整块居中的提示：Loading、无权限、空列表。深色页面传 dark（照旧后台深色底半透明卡片）。 */
export function Panel({
  children,
  dark,
}: {
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-14 text-center text-sm",
        dark
          ? "border-white/10 bg-white/[.032] text-white/60"
          : "border-stone-200 bg-white text-stone-500",
      )}
    >
      {children}
    </div>
  );
}

/** 红色提示条，可带一个按钮（Retry / Dismiss）。深色页面传 dark（照旧后台 .alert-banner）。 */
export function ErrorBanner({
  children,
  actionLabel,
  onAction,
  dark,
}: {
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  dark?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm",
        dark
          ? "border-red-500/30 bg-red-500/10 text-red-200"
          : "border-[#A32D2D]/30 bg-[#FCEBEB] text-[#A32D2D]",
      )}
    >
      <span className="min-w-0 break-words">{children}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={dark ? DARK_SECONDARY_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
