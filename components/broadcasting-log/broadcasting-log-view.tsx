"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { LegacySearch } from "@/components/send-log/legacy";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  BROADCAST_ORDER_LIMIT,
  type BroadcastLogQuery,
  fetchBroadcastLog,
  fetchBroadcastRecipients,
  fetchBroadcastsByOrder,
} from "@/lib/broadcasting-log-api";
import { downloadCsv } from "@/lib/csv";
import { isYmd, laToday } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  BroadcastLogEntry,
  BroadcastOrderHit,
  BroadcastRecipientRow,
} from "@/types";

import {
  GROUP_OPTIONS,
  GROUP_TAG,
  MODULE_OPTIONS,
  MODULE_TAG,
  presetRange,
  RANGE_OPTIONS,
  type RangePreset,
  statusTone,
} from "./config";

type LoadState =
  | { kind: "loading"; previous: BroadcastLogEntry[] | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: BroadcastLogEntry[] };

type HitResult = { rows: BroadcastOrderHit[]; truncated: boolean };
type HitState =
  | { kind: "idle" }
  | { kind: "loading"; previous: HitResult | null }
  | { kind: "error"; message: string }
  | ({ kind: "ready" } & HitResult);

const MESSAGE_PREVIEW = 60;

export function BroadcastingLogView() {
  const [preset, setPreset] = useState<RangePreset>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [customError, setCustomError] = useState<string | null>(null);
  /** 选了 Custom 但还没点 Apply：列表仍是上一个范围的结果，要写明。 */
  const [customApplied, setCustomApplied] = useState(false);
  const [query, setQuery] = useState<BroadcastLogQuery>({
    sentFrom: "",
    sentTo: "",
    module: "",
    group: "",
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({
    kind: "loading",
    previous: null,
  });
  const [open, setOpen] = useState<Set<number>>(new Set());
  /** 订单号搜索：输入框里的字、停 400ms 后真正去查的字、查到的结果。 */
  const [orderDraft, setOrderDraft] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [hits, setHits] = useState<HitState>({ kind: "idle" });
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({
      kind: "loading",
      previous:
        prev.kind === "ready"
          ? prev.rows
          : prev.kind === "loading"
            ? prev.previous
            : null,
    }));
    fetchBroadcastLog(query, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setState({ kind: "ready", rows });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [query, reloadKey, redirectToLogin]);

  // 订单号边打边查：停 400ms 才发请求（同 Order Log / Send Log）。
  useEffect(() => {
    const t = setTimeout(() => setOrderSearch(orderDraft.trim()), 400);
    return () => clearTimeout(t);
  }, [orderDraft]);

  useEffect(() => {
    if (!orderSearch) {
      setHits({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setHits((prev) => ({
      kind: "loading",
      previous:
        prev.kind === "ready"
          ? prev
          : prev.kind === "loading"
            ? prev.previous
            : null,
    }));
    fetchBroadcastsByOrder(orderSearch, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted)
          setHits({ kind: "ready", rows: r.rows, truncated: r.truncated });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else setHits({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [orderSearch, reloadKey, redirectToLogin]);

  function choosePreset(next: RangePreset) {
    // 搜索时选发送时间：清掉搜索，回到按日期看。
    setOrderDraft("");
    setOrderSearch("");
    setPreset(next);
    setCustomError(null);
    setCustomApplied(false);
    if (next !== "custom") {
      const { from, to } = presetRange(next);
      setQuery((q) => ({ ...q, sentFrom: from, sentTo: to }));
    }
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
    setCustomApplied(true);
    setQuery((q) => ({ ...q, sentFrom: custom.from, sentTo: custom.to }));
  }

  const rows =
    state.kind === "ready"
      ? state.rows
      : state.kind === "loading"
        ? state.previous
        : null;

  /** 按订单号搜着（不限日期）：Module / Group 照样在结果上筛。 */
  const searching = !!orderSearch;
  const hitData =
    hits.kind === "ready"
      ? hits
      : hits.kind === "loading"
        ? hits.previous
        : null;
  const hitRows = hitData
    ? hitData.rows.filter(
        (h) =>
          (!query.module || h.module === query.module) &&
          (!query.group || h.group_filter === query.group),
      )
    : null;

  function exportHitsCsv() {
    if (!hitRows?.length) return;
    downloadCsv(
      `broadcasting_log_${orderSearch.replace(/[^\w-]/g, "_")}.csv`,
      [
        "Sent At",
        "Sent By",
        "Product",
        "Tour Day",
        "Module",
        "Group",
        "Template",
        "Message",
        "Order #",
        "Name",
        "Phone",
        "Email",
        "SMS Status",
        "Email Status",
      ],
      hitRows.map((h) => [
        h.created_at,
        h.sent_by,
        h.product_label ?? "",
        h.tour_date ?? "",
        h.module,
        h.group_filter,
        h.template_name || "Custom message",
        h.message_body,
        h.order_number ?? "",
        h.customer_name ?? "",
        h.phone ?? "",
        h.email ?? "",
        h.sms_status ?? "",
        h.email_status ?? "",
      ]),
    );
  }

  function exportCsv() {
    if (searching) {
      exportHitsCsv();
      return;
    }
    if (!rows?.length) return;
    downloadCsv(
      `broadcasting_log_${laToday()}.csv`,
      [
        "Product",
        "Tour Day",
        "Module",
        "Group",
        "Template",
        "Message",
        "Recipients",
        "SMS Sent",
        "SMS Failed",
        "Email Sent",
        "Email Failed",
        "Sent By",
        "Sent At",
      ],
      rows.map((r) => [
        r.product_label ?? "",
        r.tour_date ?? "",
        r.module,
        r.group_filter,
        r.template_name || "Custom message",
        r.message_body,
        r.recipient_count,
        r.sms_sent,
        r.sms_failed,
        r.email_sent,
        r.email_failed,
        r.sent_by,
        r.created_at,
      ]),
    );
  }

  const appliedRangeLabel =
    preset === "custom"
      ? customApplied
        ? `${query.sentFrom} – ${query.sentTo}`
        : "Not applied yet — pick both dates and click Apply."
      : null;

  return (
    <main className="text-stone-800">
      {state.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800">Staff access required</p>
          <p className="mt-1">This page is for back-office staff only.</p>
        </Panel>
      ) : (
        <>
          {/* 旧页面 .filter-row：不是白卡片，直接放在深色底上。 */}
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            {/* 发送时间用原生下拉（差异清单 #54，待 Annie 看）；外观照旧页面的「📅 All ▾」。 */}
            <span
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[7px] border-[0.5px] border-black/[.18] bg-white pl-3 text-[13px] text-[#1a1a1a] focus-within:border-[#1a1a1a]",
                searching && "opacity-45",
              )}
            >
              <span aria-hidden>📅</span>
              <select
                aria-label="Sent"
                value={preset}
                onChange={(e) => choosePreset(e.target.value as RangePreset)}
                className="h-full cursor-pointer rounded-[7px] bg-transparent pr-2 font-[inherit] text-[13px] text-[#1a1a1a] focus:outline-none"
              >
                {RANGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </span>
            {preset === "custom" ? (
              <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#94a3b8]">
                <input
                  type="date"
                  aria-label="From"
                  value={custom.from}
                  onChange={(event) =>
                    setCustom((c) => ({ ...c, from: event.target.value }))
                  }
                  className={DATE_INPUT}
                />
                –
                <input
                  type="date"
                  aria-label="To"
                  value={custom.to}
                  onChange={(event) =>
                    setCustom((c) => ({ ...c, to: event.target.value }))
                  }
                  className={DATE_INPUT}
                />
                <button
                  type="button"
                  onClick={applyCustom}
                  className="h-7 cursor-pointer rounded-md bg-[#1a1a1a] px-3 text-[12px] text-white hover:bg-[#333]"
                >
                  Apply
                </button>
                {appliedRangeLabel ? (
                  <span className="text-[12px] text-[#94a3b8]">
                    {appliedRangeLabel}
                  </span>
                ) : null}
                {customError ? (
                  <span role="alert" className="text-[12px] text-[#fca5a5]">
                    {customError}
                  </span>
                ) : null}
              </span>
            ) : null}
            <LegacySearch
              id="order-number"
              label="Search order number (all dates)"
              placeholder="Search order # (all dates)"
              value={orderDraft}
              onChange={setOrderDraft}
              className="w-[200px]"
            />
            {searching ? (
              <span className="rounded-[10px] bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-semibold text-[#b45309]">
                Searching all dates
              </span>
            ) : null}
            <select
              aria-label="Module"
              value={query.module}
              onChange={(e) =>
                setQuery((q) => ({ ...q, module: e.target.value }))
              }
              className={SELECT}
            >
              {MODULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Group"
              value={query.group}
              onChange={(e) =>
                setQuery((q) => ({ ...q, group: e.target.value }))
              }
              className={SELECT}
            >
              {GROUP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {/* 旧后台 base.html 的 .btn（深色底上的按钮）。 */}
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] text-white transition hover:bg-white/[.08]"
            >
              ↻ Refresh
            </button>
            <span className="ml-auto text-[12px] whitespace-nowrap text-[#aaa] tabular-nums">
              {searching
                ? hits.kind === "ready" && hitRows
                  ? `${hitRows.length} ${hitRows.length === 1 ? "match" : "matches"}`
                  : ""
                : state.kind === "ready"
                  ? `${state.rows.length} records`
                  : ""}
            </span>
          </div>

          {state.kind === "error" ? (
            <div className="mb-4">
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load the broadcasting log: {state.message}
              </ErrorBanner>
            </div>
          ) : null}

          {searching ? (
            <OrderHits
              search={orderSearch}
              state={hits}
              rows={hitRows}
              onExport={exportCsv}
              onRetry={() => setReloadKey((k) => k + 1)}
            />
          ) : (
            <section className={TABLE_CARD}>
              <div className={TABLE_HEADER}>
                <h2 className={TABLE_TITLE}>Broadcasting Log</h2>
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={!rows?.length}
                  title="CSV of the broadcasts shown (opens in Excel)"
                  className={BTN_EXPORT}
                >
                  ⬇ Export
                </button>
              </div>
              <div className="overflow-x-auto">
                <table
                  className={cn(
                    "w-full min-w-[1100px] border-collapse text-[13px]",
                    state.kind === "loading" && rows && "opacity-60",
                  )}
                >
                  <thead>
                    <tr>
                      <th className={TH}>Product</th>
                      <th className={TH}>Tour day</th>
                      <th className={TH}>Module</th>
                      <th className={TH}>Group</th>
                      <th className={TH}>Template</th>
                      <th className={TH}>Message</th>
                      <th className={TH}>Recipients</th>
                      <th className={cn(TH, "text-center")}>
                        SMS <span className={NUM_OK}>✓</span>
                        <span className="text-[#ccc]">/</span>
                        <span className={NUM_FAIL}>✗</span>
                      </th>
                      <th className={cn(TH, "text-center")}>
                        Email <span className={NUM_OK}>✓</span>
                        <span className="text-[#ccc]">/</span>
                        <span className={NUM_FAIL}>✗</span>
                      </th>
                      <th className={TH}>Sent by</th>
                      <th className={TH}>Sent at</th>
                      <th className={TH} />
                    </tr>
                  </thead>
                  <tbody className="text-[#444]">
                    {!rows || rows.length === 0 ? (
                      <tr>
                        <td colSpan={12} className={EMPTY}>
                          {state.kind === "loading"
                            ? "Loading…"
                            : state.kind === "error"
                              ? "Failed to load."
                              : "No records found."}
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <Fragment key={r.id}>
                          <LogRow
                            row={r}
                            open={open.has(r.id)}
                            onToggle={() =>
                              setOpen((set) => {
                                const next = new Set(set);
                                if (next.has(r.id)) next.delete(r.id);
                                else next.add(r.id);
                                return next;
                              })
                            }
                          />
                          {open.has(r.id) ? (
                            <tr className="border-b-[0.5px] border-black/5 bg-[#fafaf9] last:border-b-0">
                              <td colSpan={12} className="px-4 py-2.5">
                                <Recipients
                                  id={r.id}
                                  onUnauthorized={redirectToLogin}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
      <HowToUse
        title="How to use — Broadcasting Log"
        items={[
          "The page shows every broadcast, newest first. To send one, use 📣 Broadcast on the Tour or Tickets tracking page.",
          "Narrow it with 📅 (the day it was sent; Custom needs both dates and Apply), All modules and All groups.",
          "To find one order, type its number in the search box (part of it works too). The search covers all dates and lists that guest's line from every broadcast: when, the message, and whether the SMS and email went through. Module and Group still apply. Clear the box (✕) or pick a 📅 option to go back.",
          "SMS ✓/✗ and Email ✓/✗ show how many went through and how many failed.",
          "Click ▶ Details to see each guest's result.",
          "Click ⬇ Export to download the rows on screen as a CSV (opens in Excel).",
        ]}
        warning="Red ✗ numbers: open ▶ Details and contact those guests another way."
      />
    </main>
  );
}

/** 旧页面 broadcasting_log.html 的样子（Annie 2026-10-07：和旧版一模一样）。 */
const TABLE_CARD =
  "overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white";
const TABLE_HEADER =
  "flex items-center justify-between border-b-[0.5px] border-black/[.08] bg-[#f5f5f3] px-4 py-2.5";
const TABLE_TITLE = "text-[13px] font-semibold text-[#1a1a1a]";
const BTN_EXPORT =
  "cursor-pointer rounded-[7px] border-[0.5px] border-black/20 bg-white px-3.5 py-1.5 text-[12px] text-[#444] hover:bg-[#f5f5f3] disabled:cursor-not-allowed disabled:opacity-60";
/** .filter-row select */
const SELECT =
  "cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-white px-2.5 py-1.5 font-[inherit] text-[13px] text-[#1a1a1a] focus:outline-none";
const DATE_INPUT =
  "h-7 cursor-pointer rounded-md border-[0.5px] border-black/15 bg-white px-2 text-[12px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none";
/** .bcast-tbl thead td / tbody td / tbody tr（字色 #444 写在 tbody 上）。 */
const TH =
  "border-b-[0.5px] border-black/[.08] bg-[#fafaf9] px-3 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#888]";
const TD = "px-3 py-[9px] align-middle";
const TR = "border-b-[0.5px] border-black/5 last:border-b-0 hover:bg-[#fafaf9]";
const EMPTY = "p-10 text-center text-[14px] text-[#aaa]";
const NUM_OK = "font-semibold text-[#2F7851]";
const NUM_FAIL = "font-semibold text-[#A32D2D]";

/** .tag */
function Tag({
  tag,
  raw,
}: {
  tag?: { label: string; className: string };
  raw: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-[10px] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tag?.className ?? "bg-[#f1efe8] text-[#5f5e5a]",
      )}
    >
      {tag?.label ?? (raw || "—")}
    </span>
  );
}

function Counts({ ok, failed }: { ok: number; failed: number }) {
  return (
    <span className="tabular-nums">
      <span className={NUM_OK}>{ok}</span>
      <span className="text-[#ccc]">/</span>
      <span className={NUM_FAIL}>{failed}</span>
    </span>
  );
}

function LogRow({
  row: r,
  open,
  onToggle,
}: {
  row: BroadcastLogEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const body = r.message_body || "";
  return (
    <tr className={TR}>
      <td className={cn(TD, "font-semibold whitespace-nowrap")}>
        {r.product_label || "—"}
      </td>
      <td className={cn(TD, "whitespace-nowrap text-[#888]")}>
        {r.tour_date || "—"}
      </td>
      <td className={TD}>
        <Tag tag={MODULE_TAG[r.module]} raw={r.module} />
      </td>
      <td className={TD}>
        <Tag tag={GROUP_TAG[r.group_filter]} raw={r.group_filter} />
      </td>
      <td className={cn(TD, "text-[12px] text-[#888]")}>
        {r.template_name || "Custom message"}
      </td>
      <td
        className={cn(TD, "max-w-[260px] text-[12px] [overflow-wrap:anywhere]")}
        title={body}
      >
        {body
          ? body.length > MESSAGE_PREVIEW
            ? `${body.slice(0, MESSAGE_PREVIEW)}…`
            : body
          : "—"}
      </td>
      <td className={cn(TD, "text-center tabular-nums")}>
        {r.recipient_count || 0}
      </td>
      <td className={cn(TD, "text-center whitespace-nowrap")}>
        <Counts ok={r.sms_sent} failed={r.sms_failed} />
      </td>
      <td className={cn(TD, "text-center whitespace-nowrap")}>
        <Counts ok={r.email_sent} failed={r.email_failed} />
      </td>
      <td className={cn(TD, "font-medium")}>{r.sent_by || "—"}</td>
      <td className={cn(TD, "whitespace-nowrap text-[#888]")}>
        {r.created_at}
      </td>
      <td className={TD}>
        {/* 旧页面 .expand-btn */}
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="cursor-pointer rounded px-1.5 py-0.5 text-[12px] whitespace-nowrap text-[#888] hover:bg-[#f0f0f0] hover:text-[#333]"
        >
          {open ? "▼" : "▶"} Details
        </button>
      </td>
    </tr>
  );
}

/** .rec-table td */
const REC_TD = "border-b-[0.5px] border-black/[.06] px-2.5 py-[5px]";

/** 展开后才拉收件人；拉不到可以重试（旧页面拉失败也当作「没有收件人」，且不再重试）。 */
function Recipients({
  id,
  onUnauthorized,
}: {
  id: number;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; rows: BroadcastRecipientRow[] }
  >({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchBroadcastRecipients(id, controller.signal)
      .then((rows) => setState({ kind: "ready", rows }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [id, attempt]);

  if (state.kind === "loading")
    return <p className="text-[12px] text-[#aaa]">Loading…</p>;
  if (state.kind === "error") {
    return (
      <p className="text-[12px] text-[#A32D2D]">
        Failed to load recipients: {state.message}{" "}
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="font-semibold underline"
        >
          Retry
        </button>
      </p>
    );
  }
  if (!state.rows.length)
    return <p className="text-[12px] text-[#aaa]">No recipients recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold text-[#888]">
            <th className={cn(REC_TD, "font-semibold")}>Order #</th>
            <th className={cn(REC_TD, "font-semibold")}>Name</th>
            <th className={cn(REC_TD, "font-semibold")}>Phone</th>
            <th className={cn(REC_TD, "font-semibold")}>Email</th>
            <th className={cn(REC_TD, "font-semibold")}>SMS</th>
            <th className={cn(REC_TD, "font-semibold")}>Email</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r, i) => (
            <tr key={i} className="[&:last-child>td]:border-b-0">
              <td className={cn(REC_TD, "font-medium text-[#2F7851]")}>
                {r.order_number || "—"}
              </td>
              <td className={REC_TD}>{r.customer_name || "—"}</td>
              <td className={cn(REC_TD, "text-[#888]")}>{r.phone || "—"}</td>
              <td className={cn(REC_TD, "text-[11px] text-[#888]")}>
                {r.email || "—"}
              </td>
              <td className={REC_TD}>
                <StatusTag value={r.sms_status} />
              </td>
              <td className={REC_TD}>
                <StatusTag value={r.email_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 按订单号搜的结果（Annie 2026-10-05 选的显示方式）：只列这一单在每次群发里的那一行，
 * 带上那次群发的时间、谁发的、消息，以及这位客人的短信 / 邮件结果。新的在前。
 * 旧页面没有这张表，样子照主表。
 */
function OrderHits({
  search,
  state,
  rows,
  onExport,
  onRetry,
}: {
  search: string;
  state: HitState;
  rows: BroadcastOrderHit[] | null;
  onExport: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      {state.kind === "error" ? (
        <div className="mb-4">
          <ErrorBanner actionLabel="Retry" onAction={onRetry}>
            Could not search the broadcasting log: {state.message}
          </ErrorBanner>
        </div>
      ) : null}
      <section className={TABLE_CARD}>
        <div className={TABLE_HEADER}>
          <h2 className={TABLE_TITLE}>
            Broadcasts to orders matching “{search}”
          </h2>
          <button
            type="button"
            onClick={onExport}
            disabled={!rows?.length}
            title="CSV of the lines shown (opens in Excel)"
            className={BTN_EXPORT}
          >
            ⬇ Export
          </button>
        </div>
        {state.kind === "ready" && state.truncated ? (
          <p className="border-b-[0.5px] border-black/[.08] bg-[#FEF3C7] px-4 py-2 text-[12px] text-[#7c4a00]">
            Showing the newest {BROADCAST_ORDER_LIMIT} matches only. Type more
            of the order number to narrow it down.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table
            className={cn(
              "w-full min-w-[1200px] border-collapse text-[13px]",
              state.kind === "loading" && rows && "opacity-60",
            )}
          >
            <thead>
              <tr>
                <th className={TH}>Sent at</th>
                <th className={TH}>Order #</th>
                <th className={TH}>Guest</th>
                <th className={TH}>SMS</th>
                <th className={TH}>Email</th>
                <th className={TH}>Product</th>
                <th className={TH}>Tour day</th>
                <th className={TH}>Module</th>
                <th className={TH}>Group</th>
                <th className={TH}>Message</th>
                <th className={TH}>Sent by</th>
              </tr>
            </thead>
            <tbody className="text-[#444]">
              {!rows || rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className={EMPTY}>
                    {state.kind === "loading"
                      ? "Searching…"
                      : state.kind === "error"
                        ? "Failed to load."
                        : "No broadcasts went to a matching order."}
                  </td>
                </tr>
              ) : (
                rows.map((h, i) => {
                  const body = h.message_body || "";
                  return (
                    <tr key={`${h.broadcast_id}-${i}`} className={TR}>
                      <td className={cn(TD, "whitespace-nowrap text-[#888]")}>
                        {h.created_at}
                      </td>
                      <td
                        className={cn(
                          TD,
                          "font-medium whitespace-nowrap text-[#2F7851]",
                        )}
                      >
                        {h.order_number || "—"}
                      </td>
                      <td className={cn(TD, "text-[12px]")}>
                        <div className="font-medium">
                          {h.customer_name || "—"}
                        </div>
                        <div className="text-[11px] text-[#888]">
                          {[h.phone, h.email].filter(Boolean).join(" · ") ||
                            "—"}
                        </div>
                      </td>
                      <td className={cn(TD, "text-[12px]")}>
                        <StatusTag value={h.sms_status} />
                      </td>
                      <td className={cn(TD, "text-[12px]")}>
                        <StatusTag value={h.email_status} />
                      </td>
                      <td className={cn(TD, "font-semibold whitespace-nowrap")}>
                        {h.product_label || "—"}
                      </td>
                      <td className={cn(TD, "whitespace-nowrap text-[#888]")}>
                        {h.tour_date || "—"}
                      </td>
                      <td className={TD}>
                        <Tag tag={MODULE_TAG[h.module]} raw={h.module} />
                      </td>
                      <td className={TD}>
                        <Tag
                          tag={GROUP_TAG[h.group_filter]}
                          raw={h.group_filter}
                        />
                      </td>
                      <td
                        className={cn(
                          TD,
                          "max-w-[260px] text-[12px] [overflow-wrap:anywhere]",
                        )}
                        title={body}
                      >
                        <div className="text-[#888]">
                          {h.template_name || "Custom message"}
                        </div>
                        {body
                          ? body.length > MESSAGE_PREVIEW
                            ? `${body.slice(0, MESSAGE_PREVIEW)}…`
                            : body
                          : "—"}
                      </td>
                      <td className={cn(TD, "font-medium")}>
                        {h.sent_by || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** 收件人状态：好的用 .tag-general（绿），其余用 .tag-tickets（米色），同旧页面。 */
function StatusTag({ value }: { value: string | null }) {
  const tone = statusTone(value);
  if (tone === "none") return <span className="text-[#aaa]">—</span>;
  return (
    <span
      className={cn(
        "inline-block rounded-[10px] px-2 py-0.5 text-[11px] font-semibold",
        tone === "good"
          ? "bg-[#EAF3DE] text-[#3B6D11]"
          : "bg-[#F5EDE4] text-[#C4956A]",
      )}
    >
      {value}
    </span>
  );
}
