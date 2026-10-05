"use client";

import { useEffect } from "react";

/** 点框里任何地方都弹选择器的输入框类型（同旧后台 app/static/picker-click.js）。 */
const PICKER_TYPES = new Set(["date", "time", "datetime-local", "month", "week"]);

/**
 * 全站的日期 / 时间框：点框里任何地方（不只是右边的小日历图标）都弹出选择器（Annie 2026-10-05 定）。
 * 挂在根布局，document 上委托 click，不用每个框各加 onClick。
 * - 只在 click 上弹，不在 focus 上：Tab 进去直接打字照旧；
 * - disabled / readOnly 的框不弹；
 * - 浏览器没有 showPicker 或调用抛错（例如选择器已经开着）一律不管，回到浏览器默认行为。
 */
export function PickerOnClick() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const el = event.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (!PICKER_TYPES.has(el.type) || el.disabled || el.readOnly) return;
      try {
        el.showPicker?.();
      } catch {
        // 不支持或不允许：浏览器默认行为照常。
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
