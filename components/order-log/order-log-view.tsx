"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { downloadCsv } from "@/lib/csv";
import {
  type DateRange,
  DateRangePresets,
  presetRange,
} from "@/components/ui/date-range-presets";
import { laToday } from "@/lib/la-date";
import {
  fetchAllOrderLog,
  fetchOrderLog,
  ORDER_LOG_PAGE_SIZE,
} from "@/lib/order-log-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { OrderLogPage, OrderLogQuery, OrderLogRecord } from "@/types";

type LoadState =
  | { kind: "loading"; previous: OrderLogPage | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: OrderLogPage };

const SELECT =
  "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

/**
 * 事件下拉，同旧页面；去掉了 Guest Confirmed（后端固定排除，选了永远是空的）。
 */
const EVENT_OPTIONS = [
  { value: "booking_handled", label: "Marked as Handled" },
  { value: "status_changed", label: "Status Changed" },
  { value: "guest_modify_requested", label: "Modify Requested" },
  { value: "lunch_selected", label: "Lunch Updated" },
  { value: "mtlv_qty_selected", label: "MTLV Qty Selected" },
  { value: "mtlv_ticket_sent", label: "MTLV Ticket Sent" },
  { value: "mtlv_cleared", label: "MTLV Cleared" },
  { value: "action_taken", label: "Action Taken" },
  { value: "field_updated", label: "Field Updated" },
  { value: "price_override_set", label: "Price Override Set" },
  { value: "price_override_removed", label: "Price Override Removed" },
] as const;

/** 后端没给标签的员工事件（Orders 页改单时写的），前端补上名字。 */
const EXTRA_LABELS: Record<string, string> = {
  field_updated: "Field Updated",
  price_override_set: "Price Override Set",
  price_override_removed: "Price Override Removed",
};

/** 统计卡的分组：客人做的 / 员工做的。新事件类型要加进其中一组，否则只算进 Total。 */
const GUEST_EVENTS = [
  "guest_confirmed",
  "guest_modify_requested",
  "lunch_selected",
  "mtlv_qty_selected",
];
const STAFF_EVENTS = [
  "status_changed",
  "booking_handled",
  "mtlv_ticket_sent",
  "mtlv_cleared",
  "action_taken",
  "field_updated",
  "price_override_set",
  "price_override_removed",
];

const ACTOR_BADGE: Record<string, string> = {
  staff: "bg-[#E6F1FB] text-[#185FA5]",
  guest: "bg-[#EAF3DE] text-[#3B6D11]",
  system: "bg-[#EEEDFE] text-[#534AB7]",
};

const labelOf = (r: OrderLogRecord) =>
  r.event_label !== r.event_type
    ? r.event_label
    : (EXTRA_LABELS[r.event_type] ?? r.event_label);

/** 后端给的颜色只认 #RRGGBB，别的一律灰色（旧页面原样塞进 style）。 */
const colorOf = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#888888");

function emptyQuery(range: DateRange): OrderLogQuery {
  return {
    from: range.from,
    to: range.to,
    orderNumber: "",
    eventType: "",
    actorType: "",
    page: 1,
  };
}

/**
 * 2026-09-12 之前员工操作的记录时间早了 7–8 小时，凌晨的操作会落到前一天（后端待办 E131）。
 * 范围碰到那之前就提示一句。
 */
const TIME_FIX_DATE = "2026-09-12";

export function OrderLogView() {
  const [query, setQuery] = useState<OrderLogQuery | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);
  const [orderDraft, setOrderDraft] = useState("");
  const [state, setState] = useState<LoadState>({
    kind: "loading",
    previous: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 洛杉矶的今天在浏览器里算，避免服务端 / 浏览器不一致。
  useEffect(() => {
    const r = presetRange("today");
    setRange(r);
    setQuery(emptyQuery(r));
  }, []);

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
    fetchOrderLog(query, controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [query, reloadKey, redirectToLogin]);

  /** 改任何筛选都回到第 1 页（旧页面点 Filter 不回第 1 页）。 */
  function update(patch: Partial<Omit<OrderLogQuery, "page">>) {
    setQuery((q) => (q ? { ...q, ...patch, page: 1 } : q));
  }

  async function exportCsv() {
    if (!query) return;
    setExporting(true);
    setExportError(null);
    try {
      const rows = await fetchAllOrderLog(query);
      downloadCsv(
        query.from === query.to
          ? `order_log_${query.from || laToday()}.csv`
          : `order_log_${query.from}_to_${query.to}.csv`,
        [
          "Tour Date",
          "Order #",
          "Event",
          "Detail",
          "By",
          "Type",
          "Modified At",
        ],
        rows.map((r) => [
          r.tour_date,
          r.order_number,
          labelOf(r),
          r.detail,
          r.actor,
          r.actor_type,
          r.modified_at,
        ]),
      );
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setExportError(`Export failed: ${describeError(error)}`);
    } finally {
      setExporting(false);
    }
  }

  const data =
    state.kind === "ready"
      ? state.data
      : state.kind === "loading"
        ? state.previous
        : null;
  const sum = (keys: string[]) =>
    data ? keys.reduce((s, k) => s + (data.stats[k] ?? 0), 0) : null;
  const today = query ? laToday() : "";
  const pages = data ? Math.ceil(data.total / ORDER_LOG_PAGE_SIZE) : 0;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Activities
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">Order Log</h1>
          <p className="text-sm text-stone-500">
            Changes to orders by staff and guests, by the day they happened (Los
            Angeles time)
          </p>
        </header>

        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
          </Panel>
        ) : (
          <>
            <section aria-label="Summary" className="grid grid-cols-3 gap-3">
              {[
                { label: "Total", value: data?.total ?? null },
                { label: "Guest Actions", value: sum(GUEST_EVENTS) },
                { label: "Staff Actions", value: sum(STAFF_EVENTS) },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-lg border border-stone-200 bg-white px-4 py-3"
                >
                  <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">
                    {c.label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-stone-900 tabular-nums">
                    {c.value ?? "—"}
                  </div>
                </div>
              ))}
            </section>

            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex flex-col gap-1 text-xs font-medium text-stone-500">
                Date
                {range ? (
                  <DateRangePresets
                    value={range}
                    max={today || undefined}
                    onChange={(r) => {
                      setRange(r);
                      update({ from: r.from, to: r.to });
                    }}
                  />
                ) : null}
              </div>
              <form
                className="flex flex-col gap-1 text-xs font-medium text-stone-500"
                onSubmit={(e) => {
                  e.preventDefault();
                  update({ orderNumber: orderDraft });
                }}
              >
                <label htmlFor="order-number">Order #</label>
                <span className="flex gap-1.5">
                  <input
                    id="order-number"
                    type="search"
                    value={orderDraft}
                    placeholder="CHD..."
                    onChange={(e) => setOrderDraft(e.target.value)}
                    className={cn(SELECT, "w-36")}
                  />
                  <button type="submit" className={SECONDARY_BUTTON_CLASS}>
                    Filter
                  </button>
                </span>
              </form>
              <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
                Event
                <select
                  value={query?.eventType ?? ""}
                  onChange={(e) => update({ eventType: e.target.value })}
                  className={SELECT}
                >
                  <option value="">All</option>
                  {EVENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
                By
                <select
                  value={query?.actorType ?? ""}
                  onChange={(e) => update({ actorType: e.target.value })}
                  className={SELECT}
                >
                  <option value="">All</option>
                  <option value="staff">Staff</option>
                  <option value="guest">Guest</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setOrderDraft("");
                  const r = presetRange("today");
                  setRange(r);
                  setQuery(emptyQuery(r));
                }}
                className={SECONDARY_BUTTON_CLASS}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => void exportCsv()}
                disabled={exporting || !data?.total}
                title="CSV of every row for these filters (opens in Excel)"
                className={SECONDARY_BUTTON_CLASS}
              >
                {exporting ? "Exporting…" : "⬇ Export"}
              </button>
              <span className="ml-auto self-center text-xs text-stone-500">
                {state.kind === "ready"
                  ? `${state.data.total} records`
                  : "— records"}
              </span>
            </div>

            {state.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load the order log: {state.message}
              </ErrorBanner>
            ) : null}
            {query && query.from && query.from < TIME_FIX_DATE ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                Changes made by staff before Sep 12, 2026 show a time 7–8 hours
                too early, so a change made early in the morning may be listed
                under the day before.
              </p>
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
              <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">
                📒 Order Log
              </h2>
              <div className="overflow-x-auto">
                <table
                  className={cn(
                    "w-full min-w-[900px] border-collapse text-sm",
                    state.kind === "loading" && data && "opacity-60",
                  )}
                >
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      <th className="px-3 py-2.5">Tour Date</th>
                      <th className="px-3 py-2.5">Order #</th>
                      <th className="px-3 py-2.5">Event</th>
                      <th className="px-3 py-2.5">Detail</th>
                      <th className="px-3 py-2.5">By</th>
                      <th className="px-3 py-2.5">Type</th>
                      <th className="px-3 py-2.5">Modified At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!data || data.records.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-12 text-center text-stone-500"
                        >
                          {state.kind === "loading"
                            ? "Loading…"
                            : state.kind === "error"
                              ? "Failed to load."
                              : "No records found."}
                        </td>
                      </tr>
                    ) : (
                      data.records.map((r) => {
                        const color = colorOf(r.event_color);
                        return (
                          <tr
                            key={r.id}
                            className="border-b border-stone-100 align-top"
                          >
                            <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                              {r.tour_date}
                            </td>
                            <td className="px-3 py-2.5 font-mono font-medium text-[#378ADD]">
                              {r.order_number}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
                                style={{ background: `${color}18`, color }}
                              >
                                {labelOf(r)}
                              </span>
                            </td>
                            <td className="max-w-[300px] px-3 py-2.5 [overflow-wrap:anywhere] text-[#555]">
                              {r.detail}
                            </td>
                            <td className="px-3 py-2.5">{r.actor}</td>
                            <td className="px-3 py-2.5">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                                  ACTOR_BADGE[r.actor_type] ??
                                    "bg-[#f1efe8] text-[#5f5e5a]",
                                )}
                              >
                                {r.actor_type}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-[11px] whitespace-nowrap text-stone-400">
                              {r.modified_at}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {pages > 1 && query ? (
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
                    Page {query.page} of {pages}
                  </span>
                  <button
                    type="button"
                    disabled={query.page >= pages}
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
                📖 How to use — Order Log
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  The page shows today&rsquo;s changes to orders, by staff and
                  guests.
                </li>
                <li>
                  For other days: click Yesterday, This Week or This Month, or
                  Custom (pick both dates, then Apply).
                </li>
                <li>
                  Narrow it with Order # (then Filter), Event or By. Reset
                  clears.
                </li>
                <li>
                  Click ⬇ Export to download every row for these filters as a
                  CSV (opens in Excel).
                </li>
              </ol>
            </details>
          </>
        )}
      </div>
    </main>
  );
}
