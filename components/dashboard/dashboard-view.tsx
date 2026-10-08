"use client";

import { IBM_Plex_Sans } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

import { formatHeaderDate, greetingName } from "./config";
import { MessagesSection } from "./messages-section";
import { QuickCards } from "./quick-cards";

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
  // 页头日期只在客户端算，避免服务端和浏览器时刻不同导致 hydration 不一致。
  const [headerDate, setHeaderDate] = useState("");

  const redirectingRef = useRef(false);

  // 与其他页面一致：401 跳旧后台登录页，next 带上当前页面完整 URL。
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    setHeaderDate(formatHeaderDate(new Date()));
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
    <main
      className={cn(
        plex.className,
        "min-h-screen bg-[#06101c] bg-[radial-gradient(circle_at_78%_8%,rgba(14,165,233,.13),transparent_34%),radial-gradient(circle_at_18%_0%,rgba(59,130,246,.08),transparent_28%)] text-[#f8fafc]",
      )}
    >
      <div className="mx-auto flex max-w-[1400px] flex-col px-4 py-7 sm:px-7">
        <header className="mb-8">
          <div className="mb-2 text-xs tracking-[.04em] text-white/45">
            {headerDate}
          </div>
          <h1 className="mb-2.5 text-[28px] leading-[1.1] font-bold tracking-[-.03em] md:text-[38px]">
            {view.kind === "ready"
              ? `Good morning, ${greetingName(view.me.display_name, view.me.username)}`
              : "Dashboard"}
          </h1>
          <p className="max-w-[540px] text-sm leading-[1.65] text-white/50">
            Your daily hub for tour confirmations, morning pickup SMS, ticket
            reminders, and guest tracking.
          </p>
        </header>

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
        <>
          <QuickCards />
          <MessagesSection onUnauthorized={onUnauthorized} />
        </>
      );
  }
}

/** 同旧页面 .panel：深色底上的半透明白卡片。 */
function DarkPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm">
      {children}
    </div>
  );
}
