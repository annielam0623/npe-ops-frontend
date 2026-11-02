"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * 手机版（Annie 2026-11-01「动手」）：屏宽 < 640px（Tailwind 的 sm 以下）算手机，电脑、平板照旧。
 * 样式尽量用 `max-sm:` / `sm:` 写；只有要改行为的地方（例如 Morning Pickup Tracking 手机上只看今天）才用这个 hook。
 */
export const PHONE_QUERY = "(max-width: 639.98px)";

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

/* 手机上 My shortcuts 条收进顶栏的 ★（方案 B）：★ 和条不在同一个组件里，用一个小的共享开关。 */
let shortcutsOpen = false;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
export function setPhoneShortcutsOpen(open: boolean) {
  if (shortcutsOpen === open) return;
  shortcutsOpen = open;
  emit();
}
export function usePhoneShortcutsOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shortcutsOpen,
    () => false,
  );
}
