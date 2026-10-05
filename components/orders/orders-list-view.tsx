"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  FILTER_BAR_CLASS,
  FILTER_COUNT_CLASS,
  FILTER_INPUT_CLASS,
  FILTER_PRIMARY_BUTTON_CLASS,
  FILTER_TEXT_BUTTON_CLASS,
  FilterSelect,
} from "@/components/ui/filter-bar";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { downloadOrdersExport, fetchOrders } from "@/lib/orders-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { OrderListPage, OrderListQuery, OrderRow } from "@/types";

type Range = "upcoming" | "today" | "next7" | "month" | "all" | "custom";

const RANGES: readonly { value: Range; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "today", label: "Today" },
  { value: "next7", label: "Next 7 days" },
  { value: "month", label: "This month" },
  { value: "all", label: "All dates" },
  { value: "custom", label: "Custom" },
];

/** 团期范围（洛杉矶日期）。 */
function rangeDates(range: Exclude<Range, "custom">): {
  from: string;
  to: string;
} {
  const today = laToday();
  switch (range) {
    case "upcoming":
      return { from: today, to: "" };
    case "today":
      return { from: today, to: today };
    case "next7":
      return { from: today, to: shiftYmd(today, 6) };
    case "month": {
      const [y, m] = today.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return {
        from: `${today.slice(0, 8)}01`,
        to: `${today.slice(0, 8)}${String(last).padStart(2, "0")}`,
      };
    }
    default:
      return { from: "", to: "" };
  }
}

const TYPE_TAG: Record<string, { label: string; className: string }> = {
  bus_tour: { label: "Bus Tour", className: "bg-emerald-50 text-emerald-700" },
  ticket: { label: "Tickets", className: "bg-sky-50 text-sky-700" },
};

const STATUS_TAG: Record<string, { label: string; className: string }> = {
  confirmed: {
    label: "Confirmed",
    className: "bg-emerald-50 text-emerald-700",
  },
  pending: { label: "Pending", className: "bg-amber-50 text-amber-700" },
  on_hold: { label: "On Hold", className: "bg-orange-50 text-orange-700" },
  onhold: { label: "On Hold", className: "bg-orange-50 text-orange-700" },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700" },
};

const EXPORT_CONFIRM_OVER = 5000;

export function OrdersListView() {
  const [range, setRange] = useState<Range>("upcoming");
  const [rangeLabel, setRangeLabel] = useState("Upcoming");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [customError, setCustomError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<OrderListQuery | null>(null);
  const [state, setState] = useState<
    | { kind: "loading"; previous: OrderListPage | null }
    | { kind: "forbidden" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: OrderListPage }
  >({ kind: "loading", previous: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmExport, setConfirmExport] = useState(false);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 带 ?q= 进来（例如 Promotion Stats 点订单号）：直接搜这个、查全部日期（旧页面不读 ?q=）。
  useEffect(() => {
    const q =
      new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
    if (q) {
      setSearch(q);
      setRange("all");
      setRangeLabel("All dates");
      setQuery({ q, dateFrom: "", dateTo: "", page: 1 });
    } else {
      const { from, to } = rangeDates("upcoming");
      setQuery({ q: "", dateFrom: from, dateTo: to, page: 1 });
    }
  }, []);

  // 搜索 400ms 防抖，回到第 1 页。
  useEffect(() => {
    if (!query || search.trim() === query.q) return;
    const timer = setTimeout(
      () => setQuery((q) => (q ? { ...q, q: search.trim(), page: 1 } : q)),
      400,
    );
    return () => clearTimeout(timer);
  }, [search, query]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setState((prev) => ({
      kind: "loading",
      previous:
        prev.kind === "ready"
          ? prev.data
          : prev.kind === "loading"
            ? prev.previous
            : null,
    }));
    fetchOrders(query, controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [query, reloadKey, redirectToLogin]);

  function chooseRange(next: Range) {
    setRange(next);
    setCustomError(null);
    if (next === "custom") return;
    const { from, to } = rangeDates(next);
    setRangeLabel(RANGES.find((r) => r.value === next)?.label ?? next);
    setQuery((q) => (q ? { ...q, dateFrom: from, dateTo: to, page: 1 } : q));
  }

  function applyCustom() {
    if (!isYmd(custom.from) || !isYmd(custom.to)) {
      setCustomError("Please select both dates.");
      return;
    }
    if (custom.from > custom.to) {
      setCustomError("The start date is after the end date.");
      return;
    }
    setCustomError(null);
    setRangeLabel(`${custom.from} – ${custom.to}`);
    setQuery((q) =>
      q ? { ...q, dateFrom: custom.from, dateTo: custom.to, page: 1 } : q,
    );
  }

  async function runExport() {
    if (!query) return { status: "ok" } as const;
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await downloadOrdersExport(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
      } else {
        setExportError(
          `Export failed (${describeError(error)}). Your filters are unchanged and nothing was downloaded. Try again, or narrow the date range first.`,
        );
      }
    } finally {
      setExporting(false);
      setConfirmExport(false);
    }
    return { status: "ok" } as const;
  }

  const data =
    state.kind === "ready"
      ? state.data
      : state.kind === "loading"
        ? state.previous
        : null;
  const total = state.kind === "ready" ? state.data.total : null;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Operations
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">Orders</h1>
        </header>

        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
          </Panel>
        ) : (
          <>
            <div className={FILTER_BAR_CLASS}>
              {/* 保留原生 type="search"（读屏是 searchbox），只换成 26px 紧凑样式。 */}
              <input
                type="search"
                aria-label="Search"
                value={search}
                placeholder="Search order#, name, email, phone, product..."
                onChange={(e) => setSearch(e.target.value)}
                className={cn(FILTER_INPUT_CLASS, "w-72")}
              />
              <FilterSelect
                label="Tour date"
                value={range}
                onChange={(v) => chooseRange(v as Range)}
              >
                {RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </FilterSelect>
              {range === "custom" ? (
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
                  <input
                    type="date"
                    aria-label="From"
                    value={custom.from}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, from: e.target.value }))
                    }
                    className={FILTER_INPUT_CLASS}
                  />
                  –
                  <input
                    type="date"
                    aria-label="To"
                    value={custom.to}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, to: e.target.value }))
                    }
                    className={FILTER_INPUT_CLASS}
                  />
                  <button
                    type="button"
                    onClick={applyCustom}
                    className={FILTER_PRIMARY_BUTTON_CLASS}
                  >
                    Apply
                  </button>
                  {customError ? (
                    <span role="alert" className="text-xs text-red-700">
                      {customError}
                    </span>
                  ) : (
                    <span className="text-xs text-stone-500">
                      Showing: {rangeLabel}
                    </span>
                  )}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setRange("upcoming");
                  setRangeLabel("Upcoming");
                  const { from, to } = rangeDates("upcoming");
                  setQuery({ q: "", dateFrom: from, dateTo: to, page: 1 });
                }}
                className={FILTER_TEXT_BUTTON_CLASS}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className={FILTER_TEXT_BUTTON_CLASS}
              >
                ↻ Refresh
              </button>
              <button
                type="button"
                disabled={exporting || !total}
                onClick={() =>
                  total && total > EXPORT_CONFIRM_OVER
                    ? setConfirmExport(true)
                    : void runExport()
                }
                className={FILTER_TEXT_BUTTON_CLASS}
              >
                {exporting
                  ? "Preparing..."
                  : `⬇ Export${total ? ` (${total.toLocaleString("en-US")})` : ""}`}
              </button>
              <span className={FILTER_COUNT_CLASS}>
                {total !== null
                  ? `${total.toLocaleString("en-US")} records`
                  : ""}
              </span>
            </div>

            {state.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load orders ({state.message}). Nothing is filtered out
                - the request itself failed.
              </ErrorBanner>
            ) : null}
            {exportError ? (
              <ErrorBanner
                actionLabel="Dismiss"
                onAction={() => setExportError(null)}
              >
                {exportError}
              </ErrorBanner>
            ) : null}

            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="overflow-x-auto">
                <table
                  className={cn(
                    "w-full min-w-[1200px] border-collapse text-sm",
                    state.kind === "loading" && data && "opacity-60",
                  )}
                >
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      {[
                        "Order #",
                        "Guest",
                        "Product",
                        "Type",
                        "Rezdy Status",
                        "Tour Date",
                        "Pickup",
                        "Pax",
                        "Agent",
                        "Source",
                        "Created",
                        "Updated",
                      ].map((h) => (
                        <th key={h} className="px-3 py-2.5 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {!data || data.records.length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
                          className="px-4 py-12 text-center text-stone-500"
                        >
                          {state.kind === "loading" ? (
                            "Loading..."
                          ) : state.kind === "error" ? (
                            "Failed to load."
                          ) : query && (query.dateFrom || query.dateTo) ? (
                            <>
                              No orders with a tour date in <b>{rangeLabel}</b>.{" "}
                              <button
                                type="button"
                                onClick={() => chooseRange("all")}
                                className="font-semibold text-sky-700 underline"
                              >
                                Search all dates
                              </button>
                            </>
                          ) : (
                            "No orders found."
                          )}
                        </td>
                      </tr>
                    ) : (
                      data.records.map((r, i) => (
                        <OrderTableRow key={`${r.order_number}-${i}`} row={r} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {data && data.pages > 1 && query ? (
                <div className="flex items-center justify-center gap-3 border-t border-stone-200 px-4 py-2.5 text-sm">
                  <button
                    type="button"
                    disabled={query.page <= 1}
                    onClick={() => setQuery({ ...query, page: query.page - 1 })}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ← Prev
                  </button>
                  <span className="text-stone-600">
                    Page {query.page} of {data.pages}
                  </span>
                  <button
                    type="button"
                    disabled={query.page >= data.pages}
                    onClick={() => setQuery({ ...query, page: query.page + 1 })}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    Next →
                  </button>
                </div>
              ) : null}
            </section>

            <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
              <summary className="cursor-pointer font-semibold text-sky-900">
                📖 How to use — Orders
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  The list shows upcoming tours. Search by order #, name, email,
                  phone or product.
                </li>
                <li>
                  Pick a Tour date range (Custom: pick both dates, then Apply).
                </li>
                <li>Click an Order # to open the order.</li>
                <li>
                  Click ⬇ Export to download everything that matches as Excel.
                </li>
                <li>Clear resets the search. ↻ Refresh reloads the list.</li>
              </ol>
              <p className="mt-2">
                ⚠️ Order not found? It may be outside the date range: click
                Search all dates.
              </p>
            </details>
          </>
        )}
      </div>

      {confirmExport && total ? (
        <ConfirmDialog
          title="Download all records?"
          confirmLabel="Download"
          busyLabel="Preparing..."
          onConfirm={runExport}
          onClose={() => setConfirmExport(false)}
        >
          <p>This will download all {total.toLocaleString("en-US")} records.</p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

function Tag({
  tag,
  raw,
}: {
  tag?: { label: string; className: string };
  raw: string;
}) {
  if (raw === "—" || !raw) return <span className="text-stone-400">—</span>;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        tag?.className ?? "bg-stone-100 text-stone-600",
      )}
    >
      {tag?.label ?? raw}
    </span>
  );
}

function OrderTableRow({ row: r }: { row: OrderRow }) {
  return (
    <tr className="border-b border-stone-100 align-top">
      <td className="px-3 py-2 whitespace-nowrap">
        <Link
          href={`/orders/${encodeURIComponent(r.order_number)}`}
          className="font-medium text-[#378ADD] hover:underline"
        >
          {r.order_number}
        </Link>
      </td>
      <td className="px-3 py-2">
        {r.name}
        <br />
        <span className="text-xs text-stone-500">
          {r.phone !== "—" ? r.phone : r.email}
        </span>
      </td>
      <td className="max-w-[180px] truncate px-3 py-2" title={r.product_name}>
        {r.product_name}
      </td>
      <td className="px-3 py-2">
        <Tag tag={TYPE_TAG[r.product_type]} raw={r.product_type} />
      </td>
      <td className="px-3 py-2">
        <Tag tag={STATUS_TAG[r.status.toLowerCase()]} raw={r.status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{r.tour_date}</td>
      <td className="px-3 py-2 text-[11px]">
        {r.pickup_time}
        <br />
        {r.pickup_location}
      </td>
      <td className="px-3 py-2">{r.quantities}</td>
      <td className="px-3 py-2">{r.agent_name}</td>
      <td className="px-3 py-2">
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
          {r.source}
        </span>
      </td>
      <td className="px-3 py-2 text-[11px] whitespace-nowrap text-stone-500">
        {r.created_at}
      </td>
      <td className="px-3 py-2 text-[11px] whitespace-nowrap text-stone-500">
        {r.updated_at}
      </td>
    </tr>
  );
}
