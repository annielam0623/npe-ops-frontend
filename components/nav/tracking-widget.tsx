"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { PageLink } from "@/components/ui/page-link";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/staff-permissions";

/**
 * 三个小方块（Annie 2026-11-17「staff们习惯旧前端的小方块了，你帮我把这些圆圈改成原来这种方块吧」）：
 * 样子、图标、颜色照旧后台 dashboard.html 的 Quick Cards（.qcard-icon：圆角方块、淡色底 + 同色细边，
 * 车 / 勾选框 / 票；蓝 #3b82f6、绿 #22c55e、紫 #a855f7）。顺序照旧：Morning / Tour / Tickets。
 */
export const TRACKING_CIRCLES: readonly {
  key: string;
  label: string;
  href: string;
  color: string;
  icon: ReactNode;
}[] = [
  {
    key: "morning",
    label: "Morning Pickup tracking",
    href: "/morning-pickup/tracking",
    color: "#3b82f6",
    icon: (
      <>
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 5v3h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </>
    ),
  },
  {
    key: "tour",
    label: "Tour Confirmation tracking",
    href: "/tour-confirmation/tracking",
    color: "#22c55e",
    icon: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>
    ),
  },
  {
    key: "tickets",
    label: "Ticket Reminder tracking",
    href: "/tickets-reminder/tracking",
    color: "#a855f7",
    icon: (
      <>
        <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
        <path d="M13 5v2M13 17v2M13 11v2" />
      </>
    ),
  },
];

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
  const perms = usePermissions();
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
          // 员工权限：没勾这个模块的 view 就不显示这个圆圈。
          if (here || !perms.canOpen(c.href)) return null;
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
                // 照旧后台 .qcard-icon：圆角方块（52px 配 14px 圆角 ⇒ 约 27%），同色细边、淡色底、图标用本色；
                // 鼠标移上去同旧卡片一样外面一圈同色光。
                "flex items-center justify-center rounded-[27%] border border-[color-mix(in_srgb,var(--ac)_38%,transparent)] transition hover:shadow-[0_0_14px_color-mix(in_srgb,var(--ac)_35%,transparent)] focus-visible:shadow-[0_0_14px_color-mix(in_srgb,var(--ac)_35%,transparent)] focus-visible:outline-none",
                here
                  ? "bg-[var(--ac)] text-white"
                  : "bg-[color-mix(in_srgb,var(--ac)_12%,transparent)] text-[var(--ac)]",
                "size-[1.9em]",
              )}
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="size-[1.05em] fill-none stroke-current stroke-2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {c.icon}
              </svg>
            </PageLink>
          );
        })}
      </span>
    </span>
  );
}
