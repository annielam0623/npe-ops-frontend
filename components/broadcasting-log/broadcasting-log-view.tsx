"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  type BroadcastLogQuery,
  fetchBroadcastLog,
  fetchBroadcastRecipients,
} from "@/lib/broadcasting-log-api";
import { downloadCsv } from "@/lib/csv";
import { isYmd, laToday } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { BroadcastLogEntry, BroadcastRecipientRow } from "@/types";

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

const SELECT_CLASS =
  "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

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

  function choosePreset(next: RangePreset) {
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

  function exportCsv() {
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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Activities
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">
            Broadcasting Log
          </h1>
          <p className="text-sm text-stone-500">
            Every broadcast sent from the tracking pages. To send one, use 📣
            Broadcast on the Tour or Tickets tracking page.
          </p>
        </header>

        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </Panel>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Sent"
                value={preset}
                onChange={(event) =>
                  choosePreset(event.target.value as RangePreset)
                }
                className={SELECT_CLASS}
              >
                {RANGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    📅 {o.label}
                  </option>
                ))}
              </select>
              {preset === "custom" ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="date"
                    aria-label="From"
                    value={custom.from}
                    onChange={(event) =>
                      setCustom((c) => ({ ...c, from: event.target.value }))
                    }
                    className={SELECT_CLASS}
                  />
                  –
                  <input
                    type="date"
                    aria-label="To"
                    value={custom.to}
                    onChange={(event) =>
                      setCustom((c) => ({ ...c, to: event.target.value }))
                    }
                    className={SELECT_CLASS}
                  />
                  <button
                    type="button"
                    onClick={applyCustom}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    Apply
                  </button>
                  {appliedRangeLabel ? (
                    <span className="text-xs text-stone-500">
                      {appliedRangeLabel}
                    </span>
                  ) : null}
                  {customError ? (
                    <span role="alert" className="text-xs text-red-700">
                      {customError}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <select
                aria-label="Module"
                value={query.module}
                onChange={(event) =>
                  setQuery((q) => ({ ...q, module: event.target.value }))
                }
                className={SELECT_CLASS}
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
                onChange={(event) =>
                  setQuery((q) => ({ ...q, group: event.target.value }))
                }
                className={SELECT_CLASS}
              >
                {GROUP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className={SECONDARY_BUTTON_CLASS}
              >
                ↻ Refresh
              </button>
              <span className="ml-auto text-xs text-stone-500">
                {state.kind === "ready" ? `${state.rows.length} records` : ""}
              </span>
            </div>

            {state.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load the broadcasting log: {state.message}
              </ErrorBanner>
            ) : null}

            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
                  Broadcasting Log
                </h2>
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={!rows?.length}
                  title="CSV of the broadcasts shown (opens in Excel)"
                  className={SECONDARY_BUTTON_CLASS}
                >
                  ⬇ Export
                </button>
              </div>
              <div className="overflow-x-auto">
                <table
                  className={cn(
                    "w-full min-w-[1100px] border-collapse text-sm",
                    state.kind === "loading" && rows && "opacity-60",
                  )}
                >
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      <th className="px-3 py-2.5">Product</th>
                      <th className="px-3 py-2.5">Tour day</th>
                      <th className="px-3 py-2.5">Module</th>
                      <th className="px-3 py-2.5">Group</th>
                      <th className="px-3 py-2.5">Template</th>
                      <th className="px-3 py-2.5">Message</th>
                      <th className="px-3 py-2.5 text-center">Recipients</th>
                      <th className="px-3 py-2.5 text-center">
                        SMS <span className="text-emerald-700">✓</span>/
                        <span className="text-red-700">✗</span>
                      </th>
                      <th className="px-3 py-2.5 text-center">
                        Email <span className="text-emerald-700">✓</span>/
                        <span className="text-red-700">✗</span>
                      </th>
                      <th className="px-3 py-2.5">Sent by</th>
                      <th className="px-3 py-2.5">Sent at</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {!rows || rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
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
                            <tr className="border-b border-stone-200 bg-stone-50">
                              <td colSpan={12} className="px-4 py-3">
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
          </>
        )}
        <HowToUse
          title="How to use — Broadcasting Log"
          items={[
            "The page shows every broadcast, newest first. To send one, use 📣 Broadcast on the Tour or Tickets tracking page.",
            "Narrow it with Sent (the day it was sent; Custom needs both dates and Apply), Module and Group.",
            "SMS ✓/✗ and Email ✓/✗ show how many went through and how many failed.",
            "Click ▶ Details to see each guest's result.",
            "Click ⬇ Export to download the rows on screen as a CSV (opens in Excel).",
          ]}
          warning="Red ✗ numbers: open ▶ Details and contact those guests another way."
        />
      </div>
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
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        tag?.className ?? "bg-stone-100 text-stone-600",
      )}
    >
      {tag?.label ?? (raw || "—")}
    </span>
  );
}

function Counts({ ok, failed }: { ok: number; failed: number }) {
  return (
    <span className="tabular-nums">
      <b className="text-emerald-700">{ok}</b>
      <span className="text-stone-300">/</span>
      <b className="text-red-700">{failed}</b>
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
    <tr className="border-b border-stone-100 align-top">
      <td className="px-3 py-2.5 font-semibold whitespace-nowrap">
        {r.product_label || "—"}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-stone-500">
        {r.tour_date || "—"}
      </td>
      <td className="px-3 py-2.5">
        <Tag tag={MODULE_TAG[r.module]} raw={r.module} />
      </td>
      <td className="px-3 py-2.5">
        <Tag tag={GROUP_TAG[r.group_filter]} raw={r.group_filter} />
      </td>
      <td className="px-3 py-2.5 text-xs text-stone-500">
        {r.template_name || "Custom message"}
      </td>
      <td
        className="max-w-[260px] px-3 py-2.5 text-xs [overflow-wrap:anywhere]"
        title={body}
      >
        {body
          ? body.length > MESSAGE_PREVIEW
            ? `${body.slice(0, MESSAGE_PREVIEW)}…`
            : body
          : "—"}
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums">
        {r.recipient_count || 0}
      </td>
      <td className="px-3 py-2.5 text-center">
        <Counts ok={r.sms_sent} failed={r.sms_failed} />
      </td>
      <td className="px-3 py-2.5 text-center">
        <Counts ok={r.email_sent} failed={r.email_failed} />
      </td>
      <td className="px-3 py-2.5 font-medium">{r.sent_by || "—"}</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-stone-500">
        {r.created_at}
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="text-xs font-semibold whitespace-nowrap text-sky-700 hover:text-sky-900"
        >
          {open ? "▼" : "▶"} Details
        </button>
      </td>
    </tr>
  );
}

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
    return <p className="text-xs text-stone-500">Loading…</p>;
  if (state.kind === "error") {
    return (
      <p className="text-xs text-red-700">
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
    return <p className="text-xs text-stone-500">No recipients recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-stone-500">
            <th className="px-2 py-1">Order #</th>
            <th className="px-2 py-1">Name</th>
            <th className="px-2 py-1">Phone</th>
            <th className="px-2 py-1">Email</th>
            <th className="px-2 py-1">SMS</th>
            <th className="px-2 py-1">Email</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r, i) => (
            <tr key={i} className="border-t border-stone-200">
              <td className="px-2 py-1 font-medium text-[#2F7851]">
                {r.order_number || "—"}
              </td>
              <td className="px-2 py-1">{r.customer_name || "—"}</td>
              <td className="px-2 py-1 text-stone-500">{r.phone || "—"}</td>
              <td className="px-2 py-1 text-stone-500">{r.email || "—"}</td>
              <td className="px-2 py-1">
                <StatusTag value={r.sms_status} />
              </td>
              <td className="px-2 py-1">
                <StatusTag value={r.email_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusTag({ value }: { value: string | null }) {
  const tone = statusTone(value);
  if (tone === "none") return <span className="text-stone-400">—</span>;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-semibold",
        tone === "good"
          ? "bg-[#EAF3DE] text-[#3B6D11]"
          : "bg-[#F5EDE4] text-[#9a6c3f]",
      )}
    >
      {value}
    </span>
  );
}
