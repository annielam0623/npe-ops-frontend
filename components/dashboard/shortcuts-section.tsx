"use client";

import { usePathname } from "next/navigation";

import { ShortcutStrip } from "@/components/nav/shortcut-strip";

/**
 * My shortcuts（Dashboard 页里，Annie 2026-10-24 K2 的样子）：一行紧凑条，不换行，Tracking 靠右；
 * 窄了先把非必显的收进「…」菜单（里面有 + 添加和 Reset to default），必显的五个再放不下才整条缩小。
 * 拖拽说明收进标题的 hover 提示。Dashboard 页自己不显示 Dashboard 那一个（已经在它所属的页面）。
 * 条本身在 nav/shortcut-strip.tsx，和其他页面顶栏下面的条是同一个组件。
 */
export function ShortcutsSection() {
  const pathname = usePathname() ?? "/dashboard";
  return <ShortcutStrip variant="page" pathname={pathname} />;
}
