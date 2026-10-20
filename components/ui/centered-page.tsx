import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 内容区左右各留 10%（Annie 2026-10-19：「10% 动手」；原来各页写死 mx-auto max-w-[Npx]，屏幕大了占比太小）。
 * 百分比以侧栏右边的内容区宽度为基准（侧栏 56 / 260px 是它的兄弟元素，不算进 10%）；
 * 只在 lg（≥1024px）起加，窄屏沿用 AppFrame 内容区自带的 p-4 sm:p-7，不会横向滚动。
 */
export function CenteredPage({
  as: Tag = "div",
  className,
  children,
}: {
  as?: "div" | "main";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag data-centered-page className={cn("w-full lg:px-[10%]", className)}>
      {children}
    </Tag>
  );
}
