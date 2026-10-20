"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type DragEventHandler,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import { formatHeaderDate, greetingName } from "@/components/dashboard/config";
import {
  OrderLookupProvider,
  TopOrderSearch,
} from "@/components/order-lookup/top-order-search";
import { fetchCurrentUser } from "@/lib/auth-api";
import { canSeeSettingsItem } from "@/lib/permissions";
import { opensInOps, pageHref } from "@/lib/page-switch";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

import {
  isActive,
  NAV_MESSAGES,
  NAV_SETTINGS,
  type NavItem,
  type NavModule,
  NO_NAV_PREFIXES,
} from "./nav-config";
import { NAV_DRAG_TYPE, NavProvider, useNav } from "./nav-context";
import { pageTitleFor } from "./page-titles";
import { ShortcutBar } from "./shortcut-bar";

/**
 * 整站外框。颜色、顶栏照旧后台 base.html（深色）；侧栏按 dashboard 改版阶段一（Annie 2026-10-11 审过，
 * docs/dashboard-改版_阶段一设计.md §2.1）：
 * - 宽屏默认收起成 56px 窄条（☰ + NPE），点 ☰ 展开成 260px、把内容往右推。每次打开页面都是收起的；站内换页保持开 / 收。
 * - 展开后分组不折叠，条目平铺成按钮：点了进页面；拖到 Dashboard 的 My shortcuts 成为快捷方式；右边的钉子 = 钉住 / 取消（任何页面都能钉）。
 * - 窄屏（< lg）照旧：侧栏藏起来，点顶栏 ☰ 打开浮层；换页时关上。打印时侧栏、顶栏都不印。
 * 侧栏只为显示名字和决定显不显示 Settings 读一次 /api/me；读不到（没登录等）由各页面自己处理。
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (
    NO_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return <>{children}</>;
  }
  return (
    <NavProvider>
      <OrderLookupProvider>
        <Frame pathname={pathname}>{children}</Frame>
      </OrderLookupProvider>
    </NavProvider>
  );
}

const WIDE = "(min-width: 1024px)";

function Frame({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [open, setOpen] = useState(false);
  // 日期只在浏览器里算（服务端和浏览器时刻不同会 hydration 不一致）。
  const [today, setToday] = useState("");

  useEffect(() => setToday(formatHeaderDate(new Date())), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then(setMe)
      .catch(() => {
        // 没登录 / 没权限：页面自己会跳登录页或显示原因；侧栏只是不显示名字。
      });
    return () => controller.abort();
  }, []);

  // 窄屏的浮层换页就关；宽屏保持当前的开 / 收（设计 §2.1）。
  useEffect(() => {
    if (!window.matchMedia(WIDE).matches) setOpen(false);
  }, [pathname]);

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
        data-state={open ? "open" : "closed"}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#050b13] bg-[linear-gradient(180deg,rgba(15,23,42,.95),rgba(2,6,23,.97))] transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 print:hidden",
          open ? "translate-x-0" : "-translate-x-full lg:w-14",
        )}
      >
        {open ? (
          <OpenNav me={me} pathname={pathname} onClose={() => setOpen(false)} />
        ) : (
          <div className="hidden flex-col items-center gap-3 pt-3.5 lg:flex">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={false}
              onClick={() => setOpen(true)}
              className="flex size-10 items-center justify-center rounded-[11px] border border-white/10 bg-white/[.04] text-white hover:bg-white/[.08]"
            >
              <MenuIcon />
            </button>
            <Link
              href="/dashboard"
              className="text-[13px] font-black tracking-[-.02em] text-white"
            >
              NPE
            </Link>
          </div>
        )}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 + My shortcuts 条一起钉在上面（Annie 2026-10-14：shortcuts 当顶部导航，每页都有）。 */}
        <div
          data-app-topbar
          className="sticky top-0 z-30 shrink-0 backdrop-blur-[18px] print:hidden"
        >
          <header className="flex h-16 items-center justify-between gap-3 border-b border-white/[.06] bg-[rgba(5,11,19,.56)] px-4 sm:px-7 print:hidden">
            <span className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setOpen(true)}
                className="rounded-[10px] border border-white/10 bg-white/[.04] px-2.5 py-1 text-sm text-white lg:hidden"
              >
                ☰
              </button>
              {pathname === "/dashboard" ? (
                // dashboard 的问候语和日期放在顶栏这一行（Annie 2026-10-14：问候语不需要那么多位置）。
                // Annie 2026-10-14：问候语字放大（15 → 20）。
                <span className="truncate text-[20px] font-semibold text-white">
                  {me
                    ? `Good morning, ${greetingName(me.display_name, me.username)}`
                    : "Dashboard"}
                  {today ? (
                    <span className="ml-2.5 text-[13px] font-normal text-[#94a3b8] max-sm:hidden">
                      {today}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="truncate text-[20px] font-semibold tracking-[-.02em] text-white">
                  {pageTitleFor(pathname)}
                </span>
              )}
            </span>
            <span className="flex items-center gap-3.5">
              {/* 原来是照旧后台 base.html 的一个不能输入的搜索框样子；Annie 2026-10-14 定改成真的订单搜索，所有页面都有。 */}
              {/* 右边原来写登录名，Annie 2026-10-14 让拿掉（侧栏底部仍有名字）。 */}
              <TopOrderSearch />
            </span>
          </header>
          {/* Dashboard 自己有 My shortcuts 框；别的页面才在顶栏下面显示成导航条。 */}
          {pathname === "/dashboard" ? null : (
            <ShortcutBar pathname={pathname} />
          )}
        </div>
        <div className="min-w-0 flex-1 p-4 sm:p-7 print:p-0">{children}</div>
      </div>
      <div className="fixed right-[18px] bottom-[22px] z-[100] flex flex-col gap-[7px] print:hidden">
        <FloatButton label="Top" onClick={() => window.scrollTo({ top: 0 })}>
          <ArrowIcon d="M5 15l7-7 7 7" />
        </FloatButton>
        <FloatButton
          label="Bottom"
          onClick={() =>
            window.scrollTo({ top: document.documentElement.scrollHeight })
          }
        >
          <ArrowIcon d="M5 9l7 7 7-7" />
        </FloatButton>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-[18px] fill-none stroke-current stroke-2"
      strokeLinecap="round"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function OpenNav({
  me,
  pathname,
  onClose,
}: {
  me: CurrentUser | null;
  pathname: string;
  onClose: () => void;
}) {
  const { groups } = useNav();
  const settingsItems = me
    ? NAV_SETTINGS.items
        .filter((i) => canSeeSettingsItem(me, i))
        .filter((i) => !i.superadminOnly || me.is_superadmin)
    : [];
  return (
    <>
      <div className="relative border-b border-white/10 px-[22px] pt-6 pb-[18px]">
        <Link
          href="/dashboard"
          className="block text-[30px] leading-none font-black tracking-[-.05em] text-white"
        >
          NPE
        </Link>
        <div className="mt-[7px] text-[11px] font-bold tracking-[.08em] text-[#38bdf8] uppercase">
          Operations Center
        </div>
        {/* 这里原来还写一次名字，Annie 2026-10-14 让拿掉（名字只留 dashboard 问候语和底部账号卡片）。 */}
        <button
          type="button"
          aria-label="Close menu"
          aria-expanded
          onClick={onClose}
          className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-[10px] border border-white/10 bg-white/[.04] text-[#94a3b8] hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-[20px] [&::-webkit-scrollbar-thumb]:bg-white/[.12]">
        <p className="rounded-[10px] border border-dashed border-white/20 px-2.5 py-2 text-[11.5px] leading-[1.5] text-white/60">
          Click a button to open it. Drag it onto your desktop, or use the pin,
          to keep it as a shortcut.
        </p>
        {groups.map((g) => (
          <section
            key={g.label}
            aria-label={g.label}
            className="flex flex-col gap-1.5"
          >
            <GroupLabel>{g.label}</GroupLabel>
            {g.items.map((m) => (
              <ModuleRow key={m.id} module={m} pathname={pathname} />
            ))}
          </section>
        ))}
        {settingsItems.length > 0 ? (
          <section
            aria-label={NAV_SETTINGS.label}
            className="flex flex-col gap-1.5"
          >
            <GroupLabel>{NAV_SETTINGS.label}</GroupLabel>
            {settingsItems.map((i) => (
              <PlainRow key={i.label} item={i} pathname={pathname} />
            ))}
          </section>
        ) : null}
        <section aria-label="Messages" className="flex flex-col gap-1.5">
          <PlainRow item={NAV_MESSAGES} pathname={pathname} />
        </section>
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
    </>
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
      // 蓝色粗箭头（Annie 2026-10-11：「反正也是功能键」，照旧页面 cb3887d 的 .float-btn）。
      className="flex size-[34px] items-center justify-center rounded-full border border-white/10 bg-[rgba(15,23,42,.84)] text-[#3b82f6] backdrop-blur-[10px] hover:bg-white/[.08] hover:text-[#60a5fa]"
    >
      {children}
    </button>
  );
}

function ArrowIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-[18px] fill-none stroke-current stroke-[4]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1.5 text-[10.5px] font-bold tracking-[.09em] text-white/60 uppercase">
      {children}
    </div>
  );
}

const ROW_CLASS =
  "flex items-center rounded-[10px] border border-white/10 bg-white/[.025] transition hover:border-white/20 hover:bg-white/[.05]";
// 当前页蓝色高亮（Annie 2026-10-11：这个蓝色不用改）。
const ROW_ACTIVE =
  "border-[#38bdf8]/50 bg-[#38bdf8]/10 hover:border-[#38bdf8]/60 hover:bg-[#38bdf8]/[.14]";
const LINK_CLASS =
  "flex h-[38px] min-w-0 flex-1 items-center gap-[9px] pr-1 pl-2.5 text-[13px] font-medium text-[#e2e8f0]";

/**
 * 分批切换（lib/page-switch.ts）：在 ops 里打开的页面用站内 Link；还没切换的去同一个网址下的旧后台路径（整页打开，
 * 经 fallback 转给后端，不用再登录——Annie 2026-10-10）。
 */
function NavLink({
  href,
  className,
  children,
  ...rest
}: {
  href: string;
  className: string;
  children: ReactNode;
  "aria-current"?: "page";
  draggable?: boolean;
  onDragStart?: DragEventHandler;
  title?: string;
}) {
  if (opensInOps(href)) {
    return (
      <Link href={href} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={pageHref(href)} className={className} {...rest}>
      {children}
    </a>
  );
}

function Dot({ color }: { color?: string }) {
  return (
    <span
      aria-hidden
      className="size-[7px] shrink-0 rounded-full"
      style={{ background: color ?? "rgba(255,255,255,.4)" }}
    />
  );
}

/** 「还没有页面」的小标签：灰色描边（不用蓝色、不像按钮）。 */
export function SoonTag() {
  return (
    <span className="shrink-0 rounded-full border border-white/30 px-1.5 text-[9.5px] leading-[15px] font-bold tracking-[.06em] text-white/75">
      SOON
    </span>
  );
}

function ModuleRow({
  module: m,
  pathname,
}: {
  module: NavModule;
  pathname: string;
}) {
  const { shortcuts, saving, togglePin } = useNav();
  const active = isActive(m, pathname);
  const pinned = !!shortcuts?.includes(m.id);
  // Morning / Tour / Tickets：留在侧栏、可点，但没有把手和钉子（已经在 Tracking 小部件里）。
  if (m.noPin) {
    return (
      <div className={cn(ROW_CLASS, active && ROW_ACTIVE)} data-module={m.id}>
        <NavLink
          href={m.href!}
          aria-current={active ? "page" : undefined}
          draggable={false}
          className={cn(LINK_CLASS, "pl-[27px]")}
        >
          <Dot color={m.dot} />
          <span className="truncate">{m.label}</span>
        </NavLink>
      </div>
    );
  }
  const pinLabel = pinned
    ? `Remove ${m.label} from shortcuts`
    : `Pin ${m.label} to shortcuts`;
  return (
    <div className={cn(ROW_CLASS, active && ROW_ACTIVE)} data-module={m.id}>
      <NavLink
        href={m.href!}
        aria-current={active ? "page" : undefined}
        draggable
        title="Drag to My shortcuts"
        onDragStart={(e) => {
          e.dataTransfer.setData(NAV_DRAG_TYPE, m.id);
          e.dataTransfer.setData("text/plain", m.label);
          e.dataTransfer.effectAllowed = "copyMove";
        }}
        className={cn(LINK_CLASS, "cursor-grab active:cursor-grabbing")}
      >
        <GripIcon />
        <Dot color={m.dot} />
        <span className="truncate">{m.label}</span>
        {m.upcoming ? <SoonTag /> : null}
      </NavLink>
      <button
        type="button"
        aria-label={pinLabel}
        aria-pressed={pinned}
        title={pinLabel}
        disabled={shortcuts === null || saving}
        onClick={() => togglePin(m.id)}
        className={cn(
          "flex h-[38px] w-[34px] shrink-0 items-center justify-center disabled:cursor-wait",
          pinned ? "text-[#38bdf8]" : "text-white/50 hover:text-white",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="size-3.5 stroke-current stroke-2"
          fill={pinned ? "currentColor" : "none"}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 3h6l-1 6 4 4H6l4-4-1-6z" />
          <path d="M12 13v8" />
        </svg>
      </button>
    </div>
  );
}

/** Settings 和 Messages：不进配置，不能拖、不能钉。 */
function PlainRow({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.soon || !item.href) {
    return (
      <div
        className={cn(
          ROW_CLASS,
          "justify-between pr-3 hover:border-white/10 hover:bg-white/[.025]",
        )}
      >
        <span className={cn(LINK_CLASS, "pl-[27px] text-white/40")}>
          {item.label}
        </span>
        <span className="text-[9px] whitespace-nowrap text-white/40">
          Coming soon
        </span>
      </div>
    );
  }
  const active = isActive(item, pathname);
  const inner = (
    <>
      <span aria-hidden className="w-2 shrink-0" />
      <Dot />
      <span className="truncate">{item.label}</span>
    </>
  );
  return (
    <div className={cn(ROW_CLASS, active && ROW_ACTIVE)}>
      {item.legacy ? (
        <a href={item.href} className={LINK_CLASS}>
          {inner}
        </a>
      ) : (
        <NavLink
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={LINK_CLASS}
        >
          {inner}
        </NavLink>
      )}
    </div>
  );
}

function GripIcon() {
  return (
    <svg
      width="8"
      height="14"
      viewBox="0 0 8 14"
      aria-hidden
      className="shrink-0 fill-white/35"
    >
      <circle cx="2" cy="2" r="1.3" />
      <circle cx="6" cy="2" r="1.3" />
      <circle cx="2" cy="7" r="1.3" />
      <circle cx="6" cy="7" r="1.3" />
      <circle cx="2" cy="12" r="1.3" />
      <circle cx="6" cy="12" r="1.3" />
    </svg>
  );
}
