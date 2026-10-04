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

/**
 * 整站外框：左边侧栏（窄屏收起，点 ☰ 打开），右边页面。打印时侧栏不印。
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
    <div className="flex min-h-screen">
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="fixed top-2 left-2 z-40 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm shadow-sm lg:hidden print:hidden"
      >
        ☰
      </button>
      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden print:hidden"
        />
      ) : null}
      <nav
        aria-label="Main"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 flex-col overflow-y-auto bg-[#0b1724] text-[13px] text-slate-300 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 print:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <Link
            href="/dashboard"
            className="text-base font-semibold text-white"
          >
            NPE Ops
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="text-slate-400 lg:hidden"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 px-2 pb-4">
          <TopLink item={NAV_TOP} pathname={pathname} />
          {NAV_GROUPS.filter((g) => !g.adminOnly || me?.is_admin).map((g) => (
            <Group
              key={g.label}
              label={g.label}
              items={g.items}
              pathname={pathname}
            />
          ))}
          <TopLink item={NAV_MESSAGES} pathname={pathname} />
        </div>
        <div className="border-t border-white/10 px-4 py-3">
          {me ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">
                {(me.initials || me.username.slice(0, 2)).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-white">
                  {me.display_name || me.username}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {me.role}
                </span>
              </span>
            </div>
          ) : null}
          <a
            href={`${env.legacyAdminBaseUrl}/auth/logout`}
            className="text-xs text-slate-400 hover:text-white"
          >
            Sign out
          </a>
        </div>
      </nav>
      <div className="min-w-0 flex-1 pt-10 lg:pt-0 print:pt-0">{children}</div>
    </div>
  );
}

function itemHref(item: NavItem): string {
  return item.legacy
    ? `${env.legacyAdminBaseUrl}${item.href}`
    : (item.href ?? "#");
}

function TopLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname);
  return (
    <ItemLink item={item} active={active} className="px-3 py-2 font-semibold" />
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
  const [open, setOpen] = useState(hasActive);
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-3 py-2 text-left font-semibold hover:bg-white/5",
          hasActive && "text-white",
        )}
      >
        {label}
        <span aria-hidden className="text-[10px] text-slate-500">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 pb-1">
          {items.map((i) => (
            <ItemLink
              key={i.label}
              item={i}
              active={isActive(i, pathname)}
              className="py-1.5 pr-3 pl-6"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ItemLink({
  item,
  active,
  className,
}: {
  item: NavItem;
  active: boolean;
  className: string;
}) {
  if (item.soon) {
    return (
      <span
        className={cn(
          "flex items-center justify-between rounded-md text-slate-500",
          className,
        )}
      >
        {item.label}
        <span className="text-[10px]">Coming soon</span>
      </span>
    );
  }
  const cls = cn(
    "flex items-center justify-between rounded-md hover:bg-white/5 hover:text-white",
    active && "bg-white/10 text-white",
    className,
  );
  if (item.legacy) {
    return (
      <a href={itemHref(item)} title="Opens the old admin page" className={cls}>
        {item.label}
        <span aria-hidden className="text-[10px] text-slate-500">
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
      {item.label}
    </Link>
  );
}
