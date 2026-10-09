import { IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 深色页面共用的字体和底色（照旧后台 base.html 的 --bg:#06101c，Annie 2026-10-07：
 * 页面对着旧版做到一模一样）。dashboard-view.tsx、forecast-view.tsx 先各自抄了一份，
 * 这里收成一份，后面每迁一页改深色时直接用。
 *
 * 旧页面只加载 300–700，650 / 750 / 800 落回 700；这里同样只要这几档。
 */
export const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

/**
 * 深色页面 <main> 的底色和默认文字色（径向渐变 + var(--bg) #06101c），不换字体。
 * base.html 本身用系统字体（同 globals.css），只有自己加载 IBM Plex 的旧页面（dashboard.html 等）才用 DARK_PAGE_CLASS。
 */
export const DARK_SHELL_CLASS =
  "min-h-screen bg-[#06101c] bg-[radial-gradient(circle_at_78%_8%,rgba(14,165,233,.13),transparent_34%),radial-gradient(circle_at_18%_0%,rgba(59,130,246,.08),transparent_28%)] text-[#f8fafc]";

/** 深色外壳 + IBM Plex Sans。 */
export const DARK_PAGE_CLASS = cn(plex.className, DARK_SHELL_CLASS);

/** 同旧页面 .panel：深色底上的半透明白卡片。as 默认 div，表格卡片等需要语义标签时传 "section"。 */
export function DarkPanel({
  as: Tag = "div",
  children,
  className,
}: {
  as?: "div" | "section";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
