"use client";

import { useEffect } from "react";

/**
 * active 时离开页面先问：关标签 / 刷新走浏览器的 beforeunload；站内链接（侧栏等）是前端跳转，
 * 不触发 beforeunload ⇒ 在捕获阶段拦点击，confirm 不通过就不跳（同排车页的做法）。
 * 发送页用它：发送中跳走，剩下的批次会在后台接着发，但没人看得到结果。
 */
export function useLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const guard = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [active, message]);
}
