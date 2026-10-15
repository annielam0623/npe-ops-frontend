"use client";

import { IBM_Plex_Sans } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

import { MessagesSection } from "./messages-section";
import { QuickCards } from "./quick-cards";
import { ShortcutsSection } from "./shortcuts-section";

// 字体、配色照旧后台 dashboard.html（Annie 2026-10-07：要和旧前端一模一样，深色底）。
// 旧页面只加载 300–700，650 / 750 / 800 落回 700；这里同样只要这几档。
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; me: CurrentUser };

export function DashboardView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  // 递增即重新校验身份（首次加载、Retry）。
  const [reloadKey, setReloadKey] = useState(0);

  const redirectingRef = useRef(false);

  // 与其他页面一致：401 跳旧后台登录页，next 带上当前页面完整 URL。
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });

    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (!signal.aborted) {
          setView({ kind: "ready", me });
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (isStatus(error, 401)) {
          redirectToLogin();
        } else if (isStatus(error, 403)) {
          // driver / guide：旧 dashboard 同样是 require_staff。
          setView({ kind: "forbidden" });
        } else {
          setView({ kind: "error", message: describeError(error) });
        }
      }
    })();

    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  return (
    // 底色、内边距由整站外框（照 base.html）提供；这里只照旧 .db：max-width 1400、居中、IBM Plex Sans。
    <main className={cn(plex.className, "text-[#f8fafc]")}>
      <div className="mx-auto flex max-w-[1400px] flex-col">
        {/* 问候语和日期挪到了顶栏（Annie 2026-10-14：问候语不需要那么多位置），见 components/nav/app-frame.tsx。 */}
        <h1 className="sr-only">Dashboard</h1>

        <DashboardBody
          view={view}
          onRetry={() => setReloadKey((k) => k + 1)}
          onUnauthorized={redirectToLogin}
        />
      </div>
    </main>
  );
}

function DashboardBody({
  view,
  onRetry,
  onUnauthorized,
}: {
  view: ViewState;
  onRetry: () => void;
  onUnauthorized: () => void;
}) {
  switch (view.kind) {
    case "loading":
      return <DarkPanel>Loading...</DarkPanel>;
    case "forbidden":
      return (
        <DarkPanel>
          <p className="font-semibold">Staff access required</p>
          <p className="mt-1 text-white/60">
            This page is for back-office staff only.
          </p>
        </DarkPanel>
      );
    case "error":
      return (
        <ErrorBanner actionLabel="Retry" onAction={onRetry}>
          Failed to load your account: {view.message}
        </ErrorBanner>
      );
    case "ready":
      return (
        // 区块顺序（Annie 2026-10-14 改）：My shortcuts（原来的框，staff 自己选放哪些）→ 发送卡片 → Messages → Today's tasks
        // → Daily Operation Report。进了别的页面，同一份 shortcuts 变成顶栏下面的导航条（nav/shortcut-bar.tsx）。
        <>
          <ShortcutsSection />
          <QuickCards />
          <MessagesSection onUnauthorized={onUnauthorized} />
          <LaterPhase title="Today’s tasks" />
          <LaterPhase title="Daily Operation Report" />
        </>
      );
  }
}

/** 任务框（阶段三）、Daily Operation Report（阶段四）还没做：先留一个带标题的空框。 */
function LaterPhase({ title }: { title: string }) {
  return (
    <section
      aria-label={title}
      className="mb-[18px] rounded-[16px] border border-white/10 bg-white/[.032] px-[18px] py-4"
    >
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-[12.5px] text-white/60">
        Coming in a later phase.
      </p>
    </section>
  );
}

/** 同旧页面 .panel：深色底上的半透明白卡片。 */
function DarkPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm">
      {children}
    </div>
  );
}
