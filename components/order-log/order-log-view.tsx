"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
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
import {
  BTN_EXPORT,
  BTN_RESET,
  FILTER_BAR,
  LegacySearch,
  LegacySelect,
  PAGE_BTN,
  RECORDS_COUNT,
  TABLE_CARD,
  TABLE_HEADER,
  TABLE_TITLE,
} from "@/components/send-log/legacy";

/** 旧页面 order_log.html 的 .log-tbl thead td / tbody td（字色 #444 写在 tbody 上）。 */
const TH =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-3 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#999]";
const TD = "px-3 py-2 align-middle";

type LoadState =
  | { kind: "loading"; previous: OrderLogPage | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: OrderLogPage };

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

  // 订单号边打边查：停 400ms 才发请求。
  useEffect(() => {
    const next = orderDraft.trim();
    const t = setTimeout(() => {
      setQuery((q) =>
        q && q.orderNumber !== next ? { ...q, orderNumber: next, page: 1 } : q,
      );
    }, 400);
    return () => clearTimeout(t);
  }, [orderDraft]);

  async function exportCsv() {
    if (!query) return;
    setExporting(true);
    setExportError(null);
    try {
      const rows = await fetchAllOrderLog(query);
      downloadCsv(
        query.orderNumber.trim()
          ? `order_log_${query.orderNumber.trim().replace(/[^\w-]/g, "_")}.csv`
          : query.from === query.to
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
  /** 按订单号搜着（不限日期）。 */
  const searching = !!query?.orderNumber.trim();

  return (
    <main className="text-stone-800">
      {state.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800">Staff access required</p>
        </Panel>
      ) : (
        <>
          <section
            aria-label="Summary"
            className="mb-[18px] flex flex-wrap gap-2.5"
          >
            {[
              { label: "Total", value: data?.total ?? null },
              { label: "Guest Actions", value: sum(GUEST_EVENTS) },
              { label: "Staff Actions", value: sum(STAFF_EVENTS) },
            ].map((c) => (
              <div
                key={c.label}
                className="min-w-[100px] rounded-[10px] border-[0.5px] border-black/10 bg-white px-5 py-3 text-center"
              >
                <div className="text-[22px] font-bold text-[#1a1a1a] tabular-nums">
                  {c.value ?? "—"}
                </div>
                <div className="mt-0.5 text-[11px] text-[#aaa]">{c.label}</div>
              </div>
            ))}
          </section>

          <div className={cn(FILTER_BAR, "mb-4")}>
            {range ? (
              <DateRangePresets
                value={range}
                max={today || undefined}
                disabled={searching}
                onChange={(r) => {
                  // 搜索时点日期：清掉搜索，回到按日期看。
                  setOrderDraft("");
                  setRange(r);
                  update({ from: r.from, to: r.to, orderNumber: "" });
                }}
              />
            ) : null}
            <span className="inline-flex items-center">
              <label
                htmlFor="order-number"
                className="mr-1 text-[12px] text-[#888]"
              >
                Order #
              </label>
              <LegacySearch
                id="order-number"
                label="Search order number (all dates)"
                placeholder="Search order # (all dates)"
                value={orderDraft}
                onChange={setOrderDraft}
                className="w-[200px]"
              />
            </span>
            {searching ? (
              <span className="rounded-[10px] bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-semibold text-[#b45309]">
                Searching all dates
              </span>
            ) : null}
            <LegacySelect
              label="Event"
              value={query?.eventType ?? ""}
              onChange={(v) => update({ eventType: v })}
            >
              <option value="">All</option>
              {EVENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </LegacySelect>
            <LegacySelect
              label="By"
              value={query?.actorType ?? ""}
              onChange={(v) => update({ actorType: v })}
            >
              <option value="">All</option>
              <option value="staff">Staff</option>
              <option value="guest">Guest</option>
            </LegacySelect>
            <button
              type="button"
              onClick={() => {
                setOrderDraft("");
                const r = presetRange("today");
                setRange(r);
                setQuery(emptyQuery(r));
              }}
              className={BTN_RESET}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exporting || !data?.total}
              title="CSV of every row for these filters (opens in Excel)"
              className={BTN_EXPORT}
            >
              {exporting ? "Exporting…" : "⬇ Export"}
            </button>
            <span className={RECORDS_COUNT}>
              {state.kind === "ready"
                ? `${state.data.total} records`
                : "— records"}
            </span>
          </div>

          {state.kind === "error" ? (
            <div className="mb-4">
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load the order log: {state.message}
              </ErrorBanner>
            </div>
          ) : null}
          {query &&
          (searching || (query.from && query.from < TIME_FIX_DATE)) ? (
            <p className="mb-4 rounded-[10px] border-[0.5px] border-[#f0d58c] bg-[#FEF3C7] px-4 py-2.5 text-[12px] text-[#7c4a00]">
              Changes made by staff before Sep 12, 2026 show a time 7–8 hours
              too early, so a change made early in the morning may be listed
              under the day before.
            </p>
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

          <section className={TABLE_CARD}>
            <div className={TABLE_HEADER}>
              <h2 className={TABLE_TITLE}>📒 Order Log</h2>
            </div>
            <div className="overflow-x-auto">
              <table
                className={cn(
                  "w-full min-w-[900px] border-collapse text-[12px]",
                  state.kind === "loading" && data && "opacity-60",
                )}
              >
                <thead>
                  <tr>
                    <th className={TH}>Tour Date</th>
                    <th className={TH}>Order #</th>
                    <th className={TH}>Event</th>
                    <th className={TH}>Detail</th>
                    <th className={TH}>By</th>
                    <th className={TH}>Type</th>
                    <th className={TH}>Modified At</th>
                  </tr>
                </thead>
                <tbody className="text-[#444]">
                  {!data || data.records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-[#ccc]">
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
                          className="border-b-[0.5px] border-black/[.06] last:border-b-0 hover:bg-[#fafaf8]"
                        >
                          <td
                            className={cn(TD, "font-medium whitespace-nowrap")}
                          >
                            {r.tour_date}
                          </td>
                          <td
                            className={cn(
                              TD,
                              "font-mono font-medium text-[#378ADD]",
                            )}
                          >
                            {r.order_number}
                          </td>
                          <td className={TD}>
                            <span
                              className="inline-block rounded-[10px] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                              style={{ background: `${color}18`, color }}
                            >
                              {labelOf(r)}
                            </span>
                          </td>
                          <td
                            className={cn(
                              TD,
                              "max-w-[300px] [overflow-wrap:anywhere] text-[#555]",
                            )}
                          >
                            {r.detail}
                          </td>
                          <td className={TD}>{r.actor}</td>
                          <td className={TD}>
                            <span
                              className={cn(
                                "inline-block rounded-md px-[7px] py-0.5 text-[11px]",
                                ACTOR_BADGE[r.actor_type] ??
                                  "bg-[#f1efe8] text-[#5f5e5a]",
                              )}
                            >
                              {r.actor_type}
                            </span>
                          </td>
                          <td
                            className={cn(
                              TD,
                              "text-[11px] whitespace-nowrap text-[#aaa]",
                            )}
                          >
                            {r.modified_at}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {pages > 1 && query ? (
            <nav
              aria-label="Pagination"
              className="mt-3.5 flex items-center gap-1.5"
            >
              <span className="text-[12px] text-[#aaa] tabular-nums">
                Page {query.page} of {pages}
              </span>
              <button
                type="button"
                disabled={query.page <= 1}
                onClick={() => setQuery({ ...query, page: query.page - 1 })}
                className={PAGE_BTN}
              >
                ← Prev
              </button>
              <button
                type="button"
                disabled={query.page >= pages}
                onClick={() => setQuery({ ...query, page: query.page + 1 })}
                className={PAGE_BTN}
              >
                Next →
              </button>
            </nav>
          ) : null}

          <HowToUse
            title="How to use — Order Log"
            items={[
              "The page shows today’s changes to orders, by staff and guests.",
              "For other days: 📅 → Yesterday, This Week or This Month, or Custom (pick both dates, then Apply).",
              "To find one order, type its number in the search box (part of it works too). The search covers all dates; the date button turns grey. Clear the box (✕) or pick a date to go back.",
              "Narrow it with Event or By. Reset clears everything.",
              "Click ⬇ Export to download every row for these filters as a CSV (opens in Excel).",
            ]}
          />
        </>
      )}
    </main>
  );
}
