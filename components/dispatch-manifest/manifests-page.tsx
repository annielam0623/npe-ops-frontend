"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";

import { ManifestsPanel } from "./manifests-panel";

type Access = "loading" | "ok" | "forbidden" | { error: string };

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
});

/**
 * 临时的 Tour manifests 页：排车页迁过来之前，上传 Rezdy CSV 的面板放在这里。
 * 同排车页：默认打开明天（洛杉矶），也认 ?date=。
 */
export function ManifestsPage() {
  const [date, setDate] = useState("");
  const [access, setAccess] = useState<Access>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    setDate(isYmd(fromUrl) ? fromUrl : shiftYmd(laToday(), 1));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAccess("loading");
    fetchCurrentUser(controller.signal)
      .then(() => setAccess("ok"))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) redirectToLogin();
        else if (isStatus(e, 403)) setAccess("forbidden");
        else setAccess({ error: describeError(e) });
      });
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  function go(next: string) {
    if (!isYmd(next)) return;
    setDate(next);
    const url = new URL(window.location.href);
    url.searchParams.set("date", next);
    window.history.replaceState(null, "", url);
  }

  const today = date ? laToday() : "";
  const [y, m, d] = date ? date.split("-").map(Number) : [0, 0, 0];

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Dispatch
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">
              Tour manifests
              {date ? (
                <span className="ml-2 text-base font-normal text-stone-500">
                  {DAY_LABEL.format(Date.UTC(y, m - 1, d))}
                  {date === today
                    ? " · Today"
                    : date === shiftYmd(today, 1)
                      ? " · Tomorrow"
                      : ""}
                </span>
              ) : null}
            </h1>
          </div>
          {date ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => go(shiftYmd(date, -1))}
                className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm hover:bg-stone-50"
              >
                ‹
              </button>
              <input
                type="date"
                aria-label="Day"
                value={date}
                onChange={(e) => go(e.target.value)}
                className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
              />
              <button
                type="button"
                aria-label="Next day"
                onClick={() => go(shiftYmd(date, 1))}
                className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm hover:bg-stone-50"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => go(laToday())}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
              >
                Today
              </button>
            </div>
          ) : null}
        </header>

        {access === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
          </Panel>
        ) : typeof access === "object" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not check your login: {access.error}
          </ErrorBanner>
        ) : access === "ok" && date ? (
          <ManifestsPanel date={date} onUnauthorized={redirectToLogin} />
        ) : (
          <p className="text-sm text-stone-500">Loading…</p>
        )}
      </div>
    </main>
  );
}
