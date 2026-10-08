"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner } from "@/components/ui/panel";
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

// 样子照旧后台 admin/orders.html / base.html（Annie 2026-10-07：和旧版一模一样）。
/** base.html 的 .btn（旧页这里写了 height:32px）。 */
const LEGACY_BTN_CLASS =
  "inline-flex h-8 items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] whitespace-nowrap text-white transition hover:bg-white/[.08]";
/** 旧页 .dr-date-wrap input[type=date]。 */
const DR_DATE_CLASS =
  "h-7 cursor-pointer rounded-md border-[0.5px] border-black/15 bg-white px-2 text-[12px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none";
/** 旧页 .ord-pagination button。 */
const PAGE_BTN_CLASS =
  "h-7 cursor-pointer rounded-md border-[0.5px] border-black/15 bg-white px-2.5 text-[12px] text-[#1a1a1a] disabled:cursor-default disabled:opacity-40";

const TYPE_TAG: Record<string, { label: string; className: string }> = {
  bus_tour: { label: "Bus Tour", className: "bg-[#EAF3DE] text-[#3B6D11]" },
  ticket: { label: "Tickets", className: "bg-[#E6F1FB] text-[#185FA5]" },
};

const STATUS_TAG: Record<string, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "bg-[#EAF3DE] text-[#2F7851]" },
  pending: { label: "Pending", className: "bg-[#FEF9EC] text-[#BA7517]" },
  on_hold: { label: "On Hold", className: "bg-[#FFF0E6] text-[#C4511A]" },
  onhold: { label: "On Hold", className: "bg-[#FFF0E6] text-[#C4511A]" },
  cancelled: { label: "Cancelled", className: "bg-[#FEEEEE] text-[#A32D2D]" },
};

const SOURCE_TAG: Record<string, { label: string; className: string }> = {
  rezdy: { label: "rezdy", className: "bg-[#f1efe8] text-[#5f5e5a]" },
  excel: { label: "excel", className: "bg-[#EEEDFE] text-[#534AB7]" },
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
    <main className="text-stone-800">
      {state.kind === "forbidden" ? (
        <div className="p-6 text-center text-[13px] text-[#aaa]">
          <p className="font-medium">Staff access required</p>
        </div>
      ) : (
        <>
          {/* 照旧页 .ord-controls */}
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            {/* 保留原生 type="search"（读屏是 searchbox）。 */}
            <input
              type="search"
              aria-label="Search"
              value={search}
              placeholder="Search order#, name, email, phone, product..."
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-72 min-w-[200px] rounded-[7px] border-[0.5px] border-black/15 bg-white px-2.5 text-[13px] text-[#1a1a1a] placeholder:text-[#999] focus:outline-none"
            />
            {/* 旧页 .dr-trigger「📅 Tour date · Upcoming ▾」；ops 里是原生下拉，样子照旧。 */}
            <label className="relative flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border-[0.5px] border-black/[.18] bg-white px-3 text-[13px] whitespace-nowrap text-[#1a1a1a] select-none hover:border-black/35">
              <span aria-hidden>📅</span>
              <span className="text-[#888]">Tour date ·</span>
              <select
                aria-label="Tour date"
                value={range}
                onChange={(e) => chooseRange(e.target.value as Range)}
                className="cursor-pointer appearance-none bg-transparent text-[13px] text-[#1a1a1a] focus:outline-none"
              >
                {RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span aria-hidden className="text-[10px] text-[#aaa]">
                ▾
              </span>
            </label>
            {range === "custom" ? (
              <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#aaa]">
                <input
                  type="date"
                  aria-label="From"
                  value={custom.from}
                  onChange={(e) =>
                    setCustom((c) => ({ ...c, from: e.target.value }))
                  }
                  className={DR_DATE_CLASS}
                />
                –
                <input
                  type="date"
                  aria-label="To"
                  value={custom.to}
                  onChange={(e) =>
                    setCustom((c) => ({ ...c, to: e.target.value }))
                  }
                  className={DR_DATE_CLASS}
                />
                <button
                  type="button"
                  onClick={applyCustom}
                  className="h-7 rounded-md bg-[#1a1a1a] px-3 text-[12px] text-white hover:bg-[#333]"
                >
                  Apply
                </button>
                {customError ? (
                  <span role="alert" className="text-[12px] text-[#f87171]">
                    {customError}
                  </span>
                ) : (
                  <span className="text-[12px] text-[#94a3b8]">
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
              className={LEGACY_BTN_CLASS}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className={LEGACY_BTN_CLASS}
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
              className="h-8 cursor-pointer rounded-[7px] border-[0.5px] border-black/20 bg-white px-3.5 text-[12px] whitespace-nowrap text-[#444] hover:bg-[#f5f5f3] disabled:cursor-default disabled:opacity-60"
            >
              {exporting
                ? "Preparing..."
                : `⬇ Export${total ? ` (${total.toLocaleString("en-US")})` : ""}`}
            </button>
            <span className="ml-auto text-[13px] text-[#888]">
              {total !== null ? `${total.toLocaleString("en-US")} records` : ""}
            </span>
          </div>

          {state.kind === "error" ? (
            <div className="mb-4">
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load orders ({state.message}). Nothing is filtered out
                - the request itself failed.
              </ErrorBanner>
            </div>
          ) : null}
          {exportError ? (
            <div className="mb-4">
              <ErrorBanner
                actionLabel="Dismiss"
                onAction={() => setExportError(null)}
              >
                {exportError}
              </ErrorBanner>
            </div>
          ) : null}

          {/* 旧页 .ord-wrap */}
          <section className="overflow-hidden rounded-[10px] border-[0.5px] border-black/10 bg-white">
            <div className="overflow-x-auto">
              <table
                className={cn(
                  "w-full min-w-[900px] border-collapse text-[12px]",
                  state.kind === "loading" && data && "opacity-60",
                )}
              >
                <thead>
                  <tr className="border-b-[0.5px] border-black/[.08] text-left">
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
                      <th
                        key={h}
                        className="bg-[#fafaf8] px-2.5 py-2 text-[11px] font-semibold whitespace-nowrap text-[#999]"
                      >
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
                        className={cn(
                          "p-6 text-center text-[13px]",
                          state.kind === "error"
                            ? "text-[#c0392b]"
                            : "text-[#ccc]",
                        )}
                      >
                        {state.kind === "loading" ? (
                          "Loading..."
                        ) : state.kind === "error" ? (
                          "Failed to load."
                        ) : query && (query.dateFrom || query.dateTo) ? (
                          <>
                            No orders with a tour date in <b>{rangeLabel}</b>.
                            <br />
                            <button
                              type="button"
                              onClick={() => chooseRange("all")}
                              className="mt-2 inline-flex h-7 items-center rounded-[10px] border border-black/15 bg-white px-3.5 text-[13px] font-[650] text-[#444] hover:bg-[#f5f5f3]"
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
              <div className="flex items-center justify-center gap-2 border-t-[0.5px] border-black/[.06] p-3">
                <button
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() => setQuery({ ...query, page: query.page - 1 })}
                  className={PAGE_BTN_CLASS}
                >
                  ← Prev
                </button>
                <span className="text-[12px] text-[#888]">
                  Page {query.page} of {data.pages}
                </span>
                <button
                  type="button"
                  disabled={query.page >= data.pages}
                  onClick={() => setQuery({ ...query, page: query.page + 1 })}
                  className={PAGE_BTN_CLASS}
                >
                  Next →
                </button>
              </div>
            ) : null}
          </section>

          <HowToUse
            title="How to use — Orders"
            items={[
              "The list shows upcoming tours. Search by order #, name, email, phone or product.",
              "Click 📅 Tour date to change the range (Custom: pick both dates, then Apply).",
              "Click an Order # to open the order.",
              "Click ⬇ Export to download everything that matches as Excel.",
              "Clear resets the search. ↻ Refresh reloads the list.",
            ]}
            warning={
              <>
                Order not found? It may be outside the date range: click Search
                all dates.
                <br />
                ⚠️ &quot;Could not load orders&quot;: click ↻ Refresh.
              </>
            }
          />
        </>
      )}

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
  if (raw === "—" || !raw) return <span className="text-[#ccc]">—</span>;
  return (
    <span
      className={cn(
        "inline-block rounded-[10px] px-[7px] py-0.5 text-[11px] whitespace-nowrap",
        tag?.className ?? "bg-[#f1efe8] text-[#5f5e5a]",
      )}
    >
      {tag?.label ?? raw}
    </span>
  );
}

function OrderTableRow({ row: r }: { row: OrderRow }) {
  return (
    <tr className="border-b-[0.5px] border-black/5 text-[#444] last:border-b-0 hover:bg-[#fafaf8]">
      <td className="px-2.5 py-[7px] whitespace-nowrap">
        <Link
          href={`/orders/${encodeURIComponent(r.order_number)}`}
          className="text-[12px] font-medium text-[#378ADD] hover:underline"
        >
          {r.order_number}
        </Link>
      </td>
      <td className="px-2.5 py-[7px]">
        {r.name}
        <br />
        <span className="text-[11px] text-[#aaa]">
          {r.phone !== "—" ? r.phone : r.email}
        </span>
      </td>
      <td
        className="max-w-[180px] truncate px-2.5 py-[7px]"
        title={r.product_name}
      >
        {r.product_name}
      </td>
      <td className="px-2.5 py-[7px]">
        <Tag tag={TYPE_TAG[r.product_type]} raw={r.product_type} />
      </td>
      <td className="px-2.5 py-[7px]">
        <Tag tag={STATUS_TAG[r.status.toLowerCase()]} raw={r.status} />
      </td>
      <td className="px-2.5 py-[7px] whitespace-nowrap">{r.tour_date}</td>
      <td className="px-2.5 py-[7px] text-[11px] text-[#666]">
        {r.pickup_time}
        <br />
        {r.pickup_location}
      </td>
      <td className="px-2.5 py-[7px]">{r.quantities}</td>
      <td className="px-2.5 py-[7px] text-[11px]">{r.agent_name}</td>
      <td className="px-2.5 py-[7px]">
        <Tag
          tag={
            SOURCE_TAG[r.source] ?? {
              label: r.source,
              className: "bg-transparent",
            }
          }
          raw={r.source}
        />
      </td>
      <td className="px-2.5 py-[7px] text-[11px] whitespace-nowrap">
        {r.created_at}
      </td>
      <td className="px-2.5 py-[7px] text-[11px] whitespace-nowrap">
        {r.updated_at}
      </td>
    </tr>
  );
}
