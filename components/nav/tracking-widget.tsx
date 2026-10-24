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
 * compact = 顶栏下面的导航条（高 32px），否则是 Dashboard 的 My shortcuts 框（高 46px）。
 * 人正好在某个 Tracking 页上时，那一页的圆标实心高亮（aria-current），其余描边。
 */
export function TrackingWidget({
  label,
  compact,
}: {
  label: string;
  compact?: boolean;
}) {
  const pathname = usePathname() ?? "";
  return (
    <span
      data-tracking-widget
      className={cn(
        "flex h-full items-center",
        compact ? "gap-2 pl-3 text-[12.5px]" : "gap-2.5 pl-3.5 text-[13.5px]",
      )}
    >
      <span className="font-semibold text-white">{label}</span>
      <span aria-hidden className="h-[55%] w-px bg-white/15" />
      <span className={cn("flex", compact ? "gap-1.5" : "gap-[7px]")}>
        {TRACKING_CIRCLES.map((c) => {
          const here = pathname === c.href || pathname.startsWith(`${c.href}/`);
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
                compact ? "size-6" : "size-7",
              )}
            >
              <Zap
                aria-hidden
                strokeWidth={2.75}
                className={compact ? "size-3" : "size-3.5"}
              />
            </PageLink>
          );
        })}
      </span>
    </span>
  );
}
