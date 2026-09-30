"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import type { CurrentUser } from "@/types";

import { formatHeaderDate, greetingName } from "./config";
import { MessagesSection } from "./messages-section";
import { QuickCards } from "./quick-cards";

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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-stone-500">
            {headerDate}
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            {view.kind === "ready"
              ? `Good morning, ${greetingName(view.me.display_name, view.me.username)}`
              : "Dashboard"}
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-stone-500">
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
      return <Panel>Loading...</Panel>;
    case "forbidden":
      return (
        <Panel>
          <p className="font-medium text-stone-800">Staff access required</p>
          <p className="mt-1">This page is for back-office staff only.</p>
        </Panel>
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
