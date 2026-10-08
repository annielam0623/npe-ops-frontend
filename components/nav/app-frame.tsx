"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { fetchCurrentUser } from "@/lib/auth-api";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

import {
  isActive,
  NAV_GROUPS,
  NAV_MESSAGES,
  NAV_TOP,
  type NavItem,
  NO_NAV_PREFIXES,
} from "./nav-config";
import { pageTitleFor, showTopSearch } from "./page-titles";

/**
 * 整站外框，照旧后台 base.html（Annie 2026-10-07：和旧版一模一样，深色）：
 * 左边 244px 侧栏（NPE / Operations Center、分组可收起、当前页蓝色高亮、底部用户卡和 Sign out），
 * 右边 64px 顶栏（页面名、搜索框样子、用户名）+ 内容区（四周 28px），右下角 ↑ ↓。
 * 窄屏（< lg）侧栏收起，点 ☰ 打开——旧后台窄屏是只剩图标的窄栏，这里沿用 ops 原来的做法。打印时侧栏、顶栏都不印。
 * 侧栏只为显示名字和决定显不显示 Settings 读一次 /api/me；读不到（没登录等）由各页面自己处理。
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then(setMe)
      .catch(() => {
        // 没登录 / 没权限：页面自己会跳登录页或显示原因；侧栏只是不显示名字。
      });
    return () => controller.abort();
  }, []);

  // 换页时收起窄屏上的侧栏。
  useEffect(() => setOpen(false), [pathname]);

  if (
    NO_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-[#06101c] bg-[radial-gradient(circle_at_78%_8%,rgba(14,165,233,.13),transparent_34%),radial-gradient(circle_at_18%_0%,rgba(59,130,246,.08),transparent_28%)] bg-fixed text-[#f8fafc] print:bg-white print:bg-none print:text-black">
      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden print:hidden"
        />
      ) : null}
      <nav
        aria-label="Main"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[244px] shrink-0 flex-col border-r border-white/10 bg-[#050b13] bg-[linear-gradient(180deg,rgba(15,23,42,.95),rgba(2,6,23,.97))] transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 print:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="relative border-b border-white/10 px-[22px] pt-6 pb-[22px]">
          <Link
            href="/dashboard"
            className="block text-[30px] leading-none font-black tracking-[-.05em] text-white"
          >
            NPE
          </Link>
          <div className="mt-[7px] text-[11px] font-bold tracking-[.08em] text-[#38bdf8] uppercase">
            Operations Center
          </div>
          {me ? (
            <div className="mt-2.5 text-xs text-[#94a3b8]">
              {me.display_name || me.username}
            </div>
          ) : null}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute top-5 right-4 text-[#94a3b8] lg:hidden"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-[20px] [&::-webkit-scrollbar-thumb]:bg-white/[.12]">
          <TopLink item={NAV_TOP} icon="⌂" pathname={pathname} />
          {NAV_GROUPS.filter((g) => !g.adminOnly || me?.is_admin).map((g) => (
            <Group
              key={g.label}
              label={g.label}
              items={g.items}
              pathname={pathname}
            />
          ))}
          <TopLink item={NAV_MESSAGES} icon="✉" pathname={pathname} />
        </div>
        <div className="border-t border-white/10 px-4 pt-4 pb-[18px]">
          {me ? (
            <div className="flex items-center gap-[11px] rounded-[18px] border border-white/10 bg-white/[.04] p-3 text-white">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[.12] text-xs font-extrabold">
                {(me.initials || me.username.slice(0, 2)).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">
                  {me.display_name || me.username}
                </span>
                <span className="mt-0.5 block text-[11px] text-[#94a3b8]">
                  {me.role || "Team Member"}
                </span>
              </span>
              <span aria-hidden className="text-[#94a3b8]">
                ›
              </span>
            </div>
          ) : null}
          <a
            // 站内路径：next.config.ts 转发到后端，cookie 清的是 ops 自己网址上的那份
            // （后端待办 G32，Annie 2026-10-06 晚定）。
            href="/auth/logout"
            className="mt-2.5 block rounded-xl px-2.5 py-2 text-center text-xs text-[#94a3b8] hover:bg-white/[.06] hover:text-white"
          >
            Sign out
          </a>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/[.06] bg-[rgba(5,11,19,.56)] px-4 backdrop-blur-[18px] sm:px-7 print:hidden">
          <span className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="rounded-[10px] border border-white/10 bg-white/[.04] px-2.5 py-1 text-sm text-white lg:hidden"
            >
              ☰
            </button>
            <span className="truncate text-sm font-semibold text-[#94a3b8]">
              {pageTitleFor(pathname)}
            </span>
          </span>
          <span className="flex items-center gap-3.5">
            {/* 旧后台顶栏也是这样一个不能输入的搜索框样子（base.html .top-search），照搬。 */}
            {showTopSearch(pathname) ? (
              <span
                aria-hidden
                className="hidden h-10 w-80 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.04] px-[13px] text-[13px] text-[#94a3b8] xl:flex"
              >
                ⌕ <span>Search CHD#, guest, tour...</span>
              </span>
            ) : null}
            {me ? (
              <span className="text-[13px] text-white">{me.username}</span>
            ) : null}
          </span>
        </header>
        <div className="min-w-0 flex-1 p-4 sm:p-7 print:p-0">{children}</div>
      </div>
      <div className="fixed right-[18px] bottom-[22px] z-[100] flex flex-col gap-[7px] print:hidden">
        <FloatButton label="Top" onClick={() => window.scrollTo({ top: 0 })}>
          ↑
        </FloatButton>
        <FloatButton
          label="Bottom"
          onClick={() =>
            window.scrollTo({ top: document.documentElement.scrollHeight })
          }
        >
          ↓
        </FloatButton>
      </div>
    </div>
  );
}

function FloatButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={`Scroll to ${label.toLowerCase()}`}
      onClick={onClick}
      className="flex size-[34px] items-center justify-center rounded-full border border-white/10 bg-[rgba(15,23,42,.84)] text-[#94a3b8] backdrop-blur-[10px] hover:bg-white/[.08] hover:text-white"
    >
      {children}
    </button>
  );
}

// 旧后台每组标题前的符号、Notifications 下三项的彩色圆点。
const GROUP_ICON: Record<string, string> = {
  Operations: "▣",
  Notifications: "◌",
  Activities: "⇄",
  Reports: "▤",
  Settings: "⚙",
};
const DOT_COLOR: Record<string, string> = {
  "Morning Pickup": "bg-[#3b82f6]",
  "Tour Confirmation": "bg-[#22c55e]",
  "Ticket Reminder": "bg-[#a855f7]",
};

const TITLE_CLASS =
  "flex w-full items-center justify-between rounded-[13px] px-3 py-[11px] text-left text-sm font-bold text-[#cbd5e1] transition hover:bg-white/[.06] hover:text-white";
const ACTIVE_CLASS =
  "bg-[linear-gradient(90deg,rgba(37,99,235,.45),rgba(59,130,246,.12))] text-white shadow-[inset_3px_0_0_#3b82f6]";

function itemHref(item: NavItem): string {
  return item.legacy
    ? `${env.legacyAdminBaseUrl}${item.href}`
    : (item.href ?? "#");
}

function TopLink({
  item,
  icon,
  pathname,
}: {
  item: NavItem;
  icon: string;
  pathname: string;
}) {
  const active = isActive(item, pathname);
  const inner = (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="inline-flex w-[18px] justify-center opacity-90"
      >
        {icon}
      </span>
      <span>{item.label}</span>
    </span>
  );
  return (
    <div className="mb-3.5">
      {item.legacy ? (
        <a
          href={itemHref(item)}
          title="Opens the old admin page"
          className={TITLE_CLASS}
        >
          {inner}
          <span aria-hidden className="text-[10px] font-normal text-[#64748b]">
            old ↗
          </span>
        </a>
      ) : (
        <Link
          href={itemHref(item)}
          aria-current={active ? "page" : undefined}
          className={cn(TITLE_CLASS, active && ACTIVE_CLASS)}
        >
          {inner}
        </Link>
      )}
    </div>
  );
}

function Group({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  const hasActive = items.some((i) => isActive(i, pathname));
  // 同旧后台：当前页所在的组展开，其余收起；点组名开合。
  const [open, setOpen] = useState(hasActive);
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);
  return (
    <div className="mb-3.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(TITLE_CLASS, hasActive && ACTIVE_CLASS)}
      >
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-flex w-[18px] justify-center opacity-90"
          >
            {GROUP_ICON[label]}
          </span>
          <span>{label}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "text-[15px] text-[#94a3b8] transition-transform",
            !open && "-rotate-90",
          )}
        >
          ⌄
        </span>
      </button>
      {open ? (
        <div className="mt-1 flex flex-col gap-[3px] pl-2.5">
          {items.map((i) => (
            <ItemLink key={i.label} item={i} active={isActive(i, pathname)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const ITEM_CLASS =
  "flex min-h-9 items-center gap-2.5 rounded-xl py-[9px] pr-3 pl-[18px] text-[13px] font-medium text-[#94a3b8] transition";

function Dot({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-[7px] shrink-0 rounded-full",
        DOT_COLOR[label] ?? "bg-[#64748b]",
      )}
    />
  );
}

function ItemLink({ item, active }: { item: NavItem; active: boolean }) {
  if (item.soon) {
    return (
      <span className={cn(ITEM_CLASS, "justify-between text-[#64748b]")}>
        <span className="flex items-center gap-2.5">
          <Dot label={item.label} />
          {item.label}
        </span>
        <span className="text-[10px]">Coming soon</span>
      </span>
    );
  }
  const cls = cn(
    ITEM_CLASS,
    "hover:bg-white/[.06] hover:text-white",
    active && ACTIVE_CLASS,
  );
  if (item.legacy) {
    return (
      <a href={itemHref(item)} title="Opens the old admin page" className={cls}>
        <Dot label={item.label} />
        {item.label}
        <span aria-hidden className="ml-auto text-[10px] text-[#64748b]">
          old ↗
        </span>
      </a>
    );
  }
  return (
    <Link
      href={itemHref(item)}
      aria-current={active ? "page" : undefined}
      className={cls}
    >
      <Dot label={item.label} />
      {item.label}
    </Link>
  );
}
