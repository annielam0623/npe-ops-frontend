"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import { TopOrderSearch } from "@/components/order-lookup/top-order-search";
import { fetchCurrentUser } from "@/lib/auth-api";
import { opensInOps, pageHref } from "@/lib/page-switch";
import { usePageVisibility } from "@/lib/page-visibility";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

import { PermissionGate } from "@/components/ui/permission-gate";

import {
  isActive,
  MODULE_VISIBILITY_KEY,
  NAV_MODULES,
  NAV_SIDEBAR_IDS,
  type NavModule,
} from "./nav-config";

/** partner 首页 = /dashboard 上的 partner 版（整张 7 Days Forecast，Q1 A / Q6 A）。 */
export const PARTNER_HOME_HREF = "/dashboard";

/** 顶栏不单列的：Home 键本身就是它们（Q6 A：首页就是整张 Forecast）。 */
const NOT_IN_TOP_BAR = new Set(["dashboard", "forecast"]);

/**
 * partner 的外框（Annie 2026-10-27「动手」，preview https://claude.ai/artifact/A3ia5c3Lw9aQv7Fo9UYTJC）：
 * 「不给他们侧边栏，就是置顶的那几个就可以了，home键就是回7day」。
 * 每一页都一样：没有侧栏、没有 My shortcuts 条；顶栏 = NPE Partner 标志、Home 键、勾了的页面、订单搜索（勾了 orders.view，Q4 B）、
 * 名字 + Sign out。窄屏页面收进 ☰。右下角 ↑↓ 照旧（同 app-frame）。
 */
export function PartnerFrame({
  pathname,
  floatButtons,
  children,
}: {
  pathname: string;
  floatButtons: ReactNode;
  children: ReactNode;
}) {
  const perms = usePermissions();
  const vis = usePageVisibility();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then(setMe)
      .catch(() => {
        // 没登录 / 没权限：页面自己会跳登录页或显示原因；顶栏只是不显示名字。
      });
    return () => controller.abort();
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  const pages = NAV_SIDEBAR_IDS.filter((id) => !NOT_IN_TOP_BAR.has(id))
    .map((id) => NAV_MODULES[id])
    .filter((m) => {
      if (!m.href) return false;
      const key = MODULE_VISIBILITY_KEY[m.id];
      return (!key || vis.visible(key)) && perms.canOpen(m.href);
    });
  const homeOn = pathname === PARTNER_HOME_HREF;
  const name = me ? me.display_name || me.username : "";

  return (
    <div className="flex min-h-screen flex-col bg-[#06101c] bg-[radial-gradient(circle_at_78%_8%,rgba(14,165,233,.13),transparent_34%),radial-gradient(circle_at_18%_0%,rgba(59,130,246,.08),transparent_28%)] bg-fixed text-[#f8fafc] print:bg-white print:bg-none print:text-black">
      <div
        data-app-topbar
        data-partner-topbar
        className="sticky top-0 z-30 shrink-0 backdrop-blur-[18px] print:hidden"
      >
        <header className="flex h-16 items-center gap-3 border-b border-white/[.06] bg-[rgba(5,11,19,.56)] px-4 sm:gap-4 sm:px-7">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-[10px] border border-white/10 bg-white/[.04] px-2.5 py-1 text-sm text-white lg:hidden"
          >
            ☰
          </button>
          <Link
            href={PARTNER_HOME_HREF}
            className="flex shrink-0 items-baseline gap-2 text-white no-underline"
          >
            <span className="text-[22px] leading-none font-black tracking-[-.05em]">
              NPE
            </span>
            <span className="text-[10.5px] font-bold tracking-[.08em] text-[#38bdf8] uppercase">
              Partner
            </span>
          </Link>
          {/* Home 键：白框普通键（不是蓝色，蓝色只给提交），回整张 7 Days Forecast。 */}
          <Link
            href={PARTNER_HOME_HREF}
            data-partner-home
            aria-current={homeOn ? "page" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center rounded-[9px] border border-white/55 px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-white/[.07]",
              homeOn && "bg-white/[.10]",
            )}
          >
            Home
          </Link>
          <nav
            aria-label="Partner pages"
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto max-lg:hidden"
          >
            {pages.map((m) => (
              <PageLink key={m.id} module={m} pathname={pathname} />
            ))}
          </nav>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {perms.can("orders.view") ? <TopOrderSearch /> : null}
            {name ? (
              <span className="flex items-center gap-2 text-[13px] max-sm:hidden">
                <span className="max-w-[160px] truncate">{name}</span>
                <span className="rounded-[6px] border border-[#fdba74] bg-[rgba(251,146,60,.12)] px-1.5 text-[11px] font-semibold text-[#fdba74]">
                  Partner
                </span>
              </span>
            ) : null}
            <a
              href="/auth/logout"
              className="rounded-[8px] border border-white/10 px-2 py-[5px] text-[12.5px] whitespace-nowrap text-[#94a3b8] no-underline hover:text-white max-lg:hidden"
            >
              Sign out
            </a>
          </span>
        </header>
        {menuOpen ? (
          <nav
            aria-label="Partner pages menu"
            className="flex flex-col gap-0.5 border-b border-white/[.06] bg-[#081221] px-3 py-2.5 lg:hidden"
          >
            {pages.map((m) => (
              <PageLink key={m.id} module={m} pathname={pathname} />
            ))}
            <a
              href="/auth/logout"
              className="rounded-[8px] px-2.5 py-2 text-[14px] text-[#cbd5e1] no-underline"
            >
              Sign out
            </a>
          </nav>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 p-4 sm:p-7 print:p-0">
        <PermissionGate pathname={pathname}>{children}</PermissionGate>
      </div>
      {floatButtons}
    </div>
  );
}

function PageLink({
  module: m,
  pathname,
}: {
  module: NavModule;
  pathname: string;
}) {
  const on = isActive(m, pathname);
  const className = cn(
    "rounded-[9px] px-2.5 py-[7px] text-[13.5px] whitespace-nowrap text-[#cbd5e1] no-underline hover:bg-white/[.06] hover:text-white max-lg:text-[14px]",
    on && "bg-white/[.10] font-semibold text-white",
  );
  const href = m.href!;
  return opensInOps(href) ? (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={className}
    >
      {m.label}
    </Link>
  ) : (
    <a href={pageHref(href)} className={className}>
      {m.label}
    </a>
  );
}
