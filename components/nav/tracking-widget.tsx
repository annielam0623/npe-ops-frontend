"use client";

import { Zap } from "lucide-react";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

import { PageLink } from "@/components/ui/page-link";
import { cn } from "@/lib/utils";

/** 三个圆标：Annie 2026-10-19 定的颜色顺序，蓝 / 绿 / 紫（和侧栏里这三项的小点同色）。 */
export const TRACKING_CIRCLES = [
  {
    key: "morning",
    label: "Morning Pickup tracking",
    href: "/morning-pickup/tracking",
    color: "#3b82f6",
  },
  {
    key: "tour",
    label: "Tour Confirmation tracking",
    href: "/tour-confirmation/tracking",
    color: "#22c55e",
  },
  {
    key: "tickets",
    label: "Ticket Reminder tracking",
    href: "/tickets-reminder/tracking",
    color: "#6d5bd0",
  },
] as const;

/**
 * My shortcuts 里的 Tracking 小部件（Annie 2026-10-19 看预览同意）：一个块里三个圆标，点哪个进哪个 Tracking 页。
 * 只有 Track，没有 Send；一直在，不看自动发送开没开。外面的 <li> 负责拖拽和 ×，这里只画内容。
 * 尺寸全用 em（跟着外面 shortcut 条的字号一起缩，见 shortcut-strip.tsx）；compact = 顶栏下面的导航条。
 * 人正好在某个 Tracking 页上时，那一页的圆标不显示（Annie 2026-10-24：已经在它所属的页面，那页的 shortcut 隐藏），其余照常。
 */
export function TrackingWidget({
  label,
  compact,
  hideLabel,
}: {
  label: string;
  compact?: boolean;
  /** 隐藏「Tracking」这几个字和分隔线，只留三个圆圈（半屏以下缩窄的第一步）。 */
  hideLabel?: boolean;
}) {
  const pathname = usePathname() ?? "";
  return (
    <span
      data-tracking-widget
      className={cn(
        "flex h-full items-center",
        hideLabel
          ? "pl-[.6em]"
          : compact
            ? "gap-[.65em] pl-[.9em]"
            : "gap-[.7em] pl-[1em]",
      )}
    >
      {hideLabel ? null : (
        <>
          <span className="font-semibold text-white">{label}</span>
          <span aria-hidden className="h-[55%] w-px bg-white/15" />
        </>
      )}
      <span className="flex gap-[.5em]">
        {TRACKING_CIRCLES.map((c) => {
          const here = pathname === c.href || pathname.startsWith(`${c.href}/`);
          if (here) return null;
          return (
            <PageLink
              key={c.key}
              href={c.href}
              aria-current={here ? "page" : undefined}
              draggable={false}
              aria-label={c.label}
              title={c.label}
              data-tracking-circle={c.key}
              style={{ "--ac": c.color } as CSSProperties}
              className={cn(
                // 休息态只亮「线」本身（描边实色 + 图标提亮），不加任何 shadow/blur，不让亮光往外渗（Annie 2026-10-22，方案 B）。
                "flex items-center justify-center rounded-full border-[2px] border-[color-mix(in_srgb,var(--ac)_75%,white_25%)] transition hover:bg-[var(--ac)] hover:text-white hover:shadow-[0_0_14px_color-mix(in_srgb,var(--ac)_45%,transparent)] focus-visible:bg-[var(--ac)] focus-visible:text-white focus-visible:outline-none",
                here
                  ? "bg-[var(--ac)] text-white shadow-[0_0_12px_color-mix(in_srgb,var(--ac)_50%,transparent)]"
                  : "bg-[color-mix(in_srgb,var(--ac)_22%,transparent)] text-[color-mix(in_srgb,var(--ac)_55%,white_45%)]",
                "size-[1.9em]",
              )}
            >
              <Zap aria-hidden strokeWidth={2.75} className="size-[.95em]" />
            </PageLink>
          );
        })}
      </span>
    </span>
  );
}
