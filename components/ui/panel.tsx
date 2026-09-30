import type { ReactNode } from "react";

import { SECONDARY_BUTTON_CLASS } from "./buttons";

/** 整块居中的提示：Loading、无权限、空列表。 */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-14 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}

/** 红色提示条，可带一个按钮（Retry / Dismiss）。 */
export function ErrorBanner({
  children,
  actionLabel,
  onAction,
}: {
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-2.5 text-sm text-[#A32D2D]"
    >
      <span className="min-w-0 break-words">{children}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={SECONDARY_BUTTON_CLASS}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
