"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FILTER_BAR_CLASS,
  FILTER_BUTTON_CLASS,
  FILTER_INPUT_CLASS,
  FILTER_TEXT_BUTTON_CLASS,
} from "@/components/ui/filter-bar";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { downloadCsv } from "@/lib/csv";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { fetchManifestDay } from "@/lib/manifests-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { ManifestDay, ManifestRow } from "@/types";

import {
  blockKey,
  blockTitle,
  CSV_HEADERS,
  LANE_LABEL,
  laneTitle,
  rowsByBlock,
  STATUS_TONE,
  toCsvRow,
} from "./config";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ManifestDay };

export function ManifestsView() {
  const [date, setDate] = useState("");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 地址栏的 ?date= 是唯一的真相来源；没有 / 不合法时用洛杉矶今天。
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    setDate(isYmd(fromUrl) ? fromUrl : laToday());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const me = await fetchCurrentUser(controller.signal);
        if (!controller.signal.aborted) setIsAdmin(me.is_admin);
      } catch (error) {
        if (!controller.signal.aborted && isStatus(error, 401))
          redirectToLogin();
      }
    })();
    return () => controller.abort();
  }, [redirectToLogin]);

  useEffect(() => {
    if (!date || isAdmin === null) return;
    if (!isAdmin) {
      setState({ kind: "forbidden" });
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    window.history.replaceState(null, "", url);
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchManifestDay(date, controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [date, isAdmin, reloadKey, redirectToLogin]);

  function changeDate(next: string) {
    if (!isYmd(next) || next === date) return;
    setDate(next);
  }

  function exportCsv() {
    if (state.kind !== "ready") return;
    downloadCsv(
      `manifests_${state.data.date}.csv`,
      CSV_HEADERS,
      state.data.rows.map(toCsvRow),
    );
  }

  const today = date ? laToday() : "";
  const data = state.kind === "ready" ? state.data : null;
  const legacyCount = data
    ? data.rows.filter((r) => r.lane_source === "legacy").length
    : 0;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Operations
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">Manifests</h1>
          <p className="text-sm text-stone-500">
            Today&apos;s Rezdy orders, grouped by Settings → Products. Read-only
            — sending by name list isn&apos;t built yet.
          </p>
        </header>

        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Admin access required</p>
          </Panel>
        ) : (
          <>
            <div className={FILTER_BAR_CLASS}>
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => changeDate(shiftYmd(date, -1))}
                disabled={!date}
                className={cn(FILTER_BUTTON_CLASS, "px-2")}
              >
                ‹
              </button>
              <input
                type="date"
                aria-label="Manifest date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
                className={FILTER_INPUT_CLASS}
              />
              <button
                type="button"
                aria-label="Next day"
                onClick={() => changeDate(shiftYmd(date, 1))}
                disabled={!date}
                className={cn(FILTER_BUTTON_CLASS, "px-2")}
              >
                ›
              </button>
              <button
                type="button"
                aria-pressed={!!date && date === today}
                onClick={() => changeDate(laToday())}
                className={cn(
                  FILTER_BUTTON_CLASS,
                  !!date &&
                    date === today &&
                    "border-stone-800 bg-stone-800 text-white",
                )}
              >
                Today
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={!data?.rows.length}
                className={FILTER_TEXT_BUTTON_CLASS}
              >
                ⬇ Export CSV
              </button>
              <span className="ml-auto text-xs text-stone-500">
                {data
                  ? `${data.rows.length} row${data.rows.length === 1 ? "" : "s"}`
                  : "—"}
              </span>
            </div>

            {state.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load manifests: {state.message}
              </ErrorBanner>
            ) : null}

            {legacyCount > 0 ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                ⚠️ {legacyCount} row{legacyCount === 1 ? "" : "s"}{" "}
                {legacyCount === 1 ? "comes" : "come"} from data frozen before
                Aug 16, 2026 (marked{" "}
                <span className="font-medium">Legacy</span> below). Later Rezdy
                cancellations for these orders won&apos;t show here until the
                backend catches up.
              </p>
            ) : null}

            {state.kind === "loading" && !data ? (
              <p className="px-1 text-sm text-stone-500">Loading…</p>
            ) : null}

            {data && data.rows.length === 0 ? (
              <Panel>
                <p className="text-sm text-stone-500">
                  No live orders for this date.
                </p>
              </Panel>
            ) : null}

            {data
              ? (() => {
                  const byBlock = rowsByBlock(data.groups, data.rows);
                  return data.groups.map((g) => {
                    const key = blockKey(g);
                    const rows = byBlock.get(key) ?? [];
                    if (rows.length === 0) return null;
                    return (
                      <ManifestBlock
                        key={key}
                        title={blockTitle(g)}
                        rows={rows}
                        orders={g.orders}
                        pax={g.pax}
                      />
                    );
                  });
                })()
              : null}

            <ManifestsHowToUse />
          </>
        )}
      </div>
    </main>
  );
}

function ManifestBlock({
  title,
  rows,
  orders,
  pax,
}: {
  title: string;
  rows: ManifestRow[];
  orders: number;
  pax: number;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        <span className="text-xs text-stone-500 tabular-nums">
          {orders} order{orders === 1 ? "" : "s"} · {pax} pax · {rows.length}{" "}
          row{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
            <tr>
              <th className="px-3 py-2">Order #</th>
              <th className="px-3 py-2">Guest</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2 text-center">Pax</th>
              <th className="px-3 py-2">Pickup</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Confirmation #</th>
              <th className="px-3 py-2">Sent</th>
              <th className="px-3 py-2">Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r, i) => (
              <tr key={`${r.order_number}-${r.product_code}-${i}`}>
                <td className="px-3 py-2.5 font-mono font-medium whitespace-nowrap text-[#378ADD]">
                  {r.order_number || "—"}
                  {r.lane_source === "legacy" ? (
                    <span
                      title="From data frozen before Aug 16, 2026 — later Rezdy cancellations won't show here"
                      className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700"
                    >
                      Legacy
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {`${r.first_name} ${r.last_name}`.trim() || "—"}
                </td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                  {r.phone || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <div>{r.product_label || "—"}</div>
                  {r.category ? (
                    <div className="text-xs text-stone-400">{r.category}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-center font-semibold tabular-nums">
                  {r.pax ?? "—"}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div>{r.pickup_time || "—"}</div>
                  {r.pickup_location ? (
                    <div className="text-xs text-stone-400">
                      {r.pickup_location}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
                      STATUS_TONE[r.status] ?? STATUS_TONE.unknown,
                    )}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.confirmation_no || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(
                      Object.keys(LANE_LABEL) as (keyof typeof LANE_LABEL)[]
                    ).map((lane) => {
                      const info = r.sent[lane];
                      return (
                        <span
                          key={lane}
                          title={laneTitle(lane, info)}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
                            info
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-stone-100 text-stone-400",
                          )}
                        >
                          {LANE_LABEL[lane]}
                          {info &&
                          lane === "morning" &&
                          "partial" in info &&
                          info.partial
                            ? " ⚠"
                            : info
                              ? " ✓"
                              : ""}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap text-stone-500">
                  {r.agent_name || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ManifestsHowToUse() {
  return (
    <HowToUse
      title="How to use — Manifests"
      items={[
        <>
          Rows are today&apos;s live Rezdy orders (cancelled orders are left
          out), grouped the same way as Settings → Products: by group, then
          products in the list with no group, then product codes not in the list
          at all.
        </>,
        <>
          Use ‹ › or the date box, or click <b>Today</b>, to see another day.
          The address bar keeps <code>?date=</code> so the link can be shared.
        </>,
        <>
          The <b>Sent</b> column shows whether this order already has a Tour,
          Morning or Tickets message on record for this date — hover a pill for
          who sent it and when. A <span className="font-medium">Morning ⚠</span>{" "}
          means one channel failed last time and the other got through. This is
          informational only; sending from this page isn&apos;t built yet — use
          the Send pages or Morning Relay.
        </>,
        <>
          A row marked <b>Legacy</b> comes from data frozen before Aug 16, 2026.
          If the guest cancelled with Rezdy afterward, it may still show here as
          live until the backend catches up.
        </>,
        <>
          Click <b>⬇ Export CSV</b> to download every row shown, in the same
          order (opens in Excel).
        </>,
      ]}
    />
  );
}
