"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BTN_EXPORT,
  FILTER_BAR,
  LegacySelect,
  RECORDS_COUNT,
  TABLE_CARD,
} from "@/components/send-log/legacy";
import {
  type DateRange,
  DateRangePresets,
  presetRange,
} from "@/components/ui/date-range-presets";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  farmOutReportCsvUrl,
  fetchFarmOutReport,
  fetchPartners,
} from "@/lib/farm-out-api";
import { laToday } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { FarmOutPartner, FarmOutReportRow } from "@/types/farm-out";

import { reportRows } from "./report-rows";

const TH =
  "border-b-[0.5px] border-black/[.08] night:border-white/10 bg-paper night:bg-white/[.03] px-3 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#1a1a1a] night:text-white/35";
const TD = "px-3 py-2 align-middle whitespace-nowrap";

type LoadState =
  | { kind: "loading"; previous: FarmOutReportRow[] | null }
  | { kind: "forbidden" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: FarmOutReportRow[] };

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const money = (v: number | null) => (v == null ? "—" : USD.format(v));

const LA_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

/** 后端的时间可能不带时区（UTC）：补上 Z 再按洛杉矶显示。 */
function laTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const full = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const t = new Date(full).getTime();
  return Number.isNaN(t) ? iso : LA_TIME.format(t);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** 订单日期 YYYY-MM-DD 显示成 Oct 16（同预览）；认不出就原样。 */
function shortDate(ymd: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  return `${MONTHS[Number(m[1]) - 1] ?? m[1]} ${Number(m[2])}`;
}

function sum(
  rows: FarmOutReportRow[],
  pick: (r: FarmOutReportRow) => number | null,
) {
  return rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
}

export function FarmOutReportView() {
  const [range, setRange] = useState<DateRange | null>(null);
  const [partners, setPartners] = useState<FarmOutPartner[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [state, setState] = useState<LoadState>({
    kind: "loading",
    previous: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 洛杉矶的「本月」在浏览器里算（Annie 预览：默认本月）。
  useEffect(() => {
    setRange(presetRange("month"));
  }, []);

  // 合作公司名单只用来做筛选；拿不到（后端还没上线）时筛选里只剩 All partners。
  useEffect(() => {
    let cancelled = false;
    fetchPartners()
      .then((p) => {
        if (!cancelled) setPartners(p);
      })
      .catch((error: unknown) => {
        if (!cancelled && isStatus(error, 401)) redirectToLogin();
      });
    return () => {
      cancelled = true;
    };
  }, [redirectToLogin]);

  const pid = partnerId ? Number(partnerId) : null;

  useEffect(() => {
    if (!range) return;
    let cancelled = false;
    setState((prev) => ({
      kind: "loading",
      previous:
        prev.kind === "ready"
          ? prev.rows
          : prev.kind === "loading"
            ? prev.previous
            : null,
    }));
    fetchFarmOutReport(range.from, range.to, pid)
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", rows: reportRows(data) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        // 后端还没上线：安静地写一句，不当错误处理。
        else if (isStatus(error, 404)) setState({ kind: "unavailable" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [range, pid, reloadKey, redirectToLogin]);

  const rows =
    state.kind === "ready"
      ? state.rows
      : state.kind === "loading"
        ? state.previous
        : null;
  const today = range ? laToday() : "";
  const csvUrl = range ? farmOutReportCsvUrl(range.from, range.to, pid) : "#";

  return (
    <main className="text-stone-800 night:text-white/90">
      {state.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Staff access required
          </p>
        </Panel>
      ) : state.kind === "unavailable" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Farm out isn&apos;t available yet
          </p>
        </Panel>
      ) : (
        <>
          <div className={cn(FILTER_BAR, "mb-4")}>
            {range ? (
              <DateRangePresets
                value={range}
                max={today || undefined}
                onChange={setRange}
              />
            ) : null}
            <LegacySelect
              label="Partner"
              value={partnerId}
              onChange={setPartnerId}
            >
              <option value="">All partners</option>
              {partners.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </LegacySelect>
            {range ? (
              <span className="text-[12px] text-[#1a1a1a] tabular-nums night:text-white/55">
                {range.from} – {range.to}
              </span>
            ) : null}
            <a
              href={csvUrl}
              download
              title="CSV of every row for these filters (opens in Excel)"
              className={cn(BTN_EXPORT, "ml-auto no-underline")}
            >
              Export CSV
            </a>
            <span className={cn(RECORDS_COUNT, "ml-0")}>
              {rows ? `${rows.length} orders` : "— orders"}
            </span>
          </div>

          {state.kind === "error" ? (
            <div className="mb-4">
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load the report: {state.message}
              </ErrorBanner>
            </div>
          ) : null}

          <section className={TABLE_CARD}>
            {/* 页名和顶栏重复，只留给读屏（Annie 2026-10-19「去掉，好」：保留顶栏那个） */}
            <h2 className="sr-only">⇄ Farm out Report</h2>
            <div className="overflow-x-auto">
              <table
                className={cn(
                  "w-full min-w-[1080px] border-collapse text-[12px] tabular-nums",
                  state.kind === "loading" && rows && "opacity-60",
                )}
              >
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Tour</th>
                    <th className={TH}>Order#</th>
                    <th className={TH}>OTA conf#</th>
                    <th className={TH}>Guest</th>
                    <th className={TH}>Adults</th>
                    <th className={TH}>Children</th>
                    <th className={TH}>Partner</th>
                    <th className={TH}>Handled by</th>
                    <th className={cn(TH, "text-right")}>Guest paid</th>
                    <th className={cn(TH, "text-right")}>Payable</th>
                    <th className={cn(TH, "text-right")}>Difference</th>
                  </tr>
                </thead>
                <tbody className="text-[#1a1a1a] night:text-white/75">
                  {!rows || rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={12}
                        className="p-6 text-center text-[#1a1a1a] night:text-white/35"
                      >
                        {state.kind === "loading"
                          ? "Loading…"
                          : state.kind === "error"
                            ? "Failed to load."
                            : "No farmed-out orders in this range."}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {rows.map((r, i) => (
                        <tr
                          key={`${r.order_number}-${r.date}-${i}`}
                          className="border-b-[0.5px] border-black/[.06] hover:bg-[#fafaf8] night:border-white/10 night:hover:bg-white/[.03]"
                        >
                          <td className={TD}>{shortDate(r.date)}</td>
                          <td className={TD}>{r.tour}</td>
                          <td className={cn(TD, "font-mono")}>
                            {r.order_number}
                            {r.status === "gone_after_farm_out" ? (
                              <div
                                data-gone-after-farm-out
                                className="font-sans text-[11px] text-[#A32D2D] night:text-red-300"
                              >
                                Cancelled or changed after farm out
                              </div>
                            ) : null}
                          </td>
                          <td className={TD}>{r.ota_conf_number}</td>
                          <td className={TD}>{r.guest}</td>
                          <td className={TD}>{r.adults}</td>
                          <td className={TD}>{r.children}</td>
                          <td className={TD}>{r.partner}</td>
                          <td className={TD}>{r.handled_by}</td>
                          <td className={cn(TD, "text-right")}>
                            {money(r.guest_paid)}
                          </td>
                          <td
                            className={cn(TD, "text-right")}
                            title={
                              r.payable_changed_by
                                ? `Changed by ${r.payable_changed_by}${r.payable_changed_at ? `, ${laTime(r.payable_changed_at)}` : ""}`
                                : undefined
                            }
                          >
                            {money(r.payable)}
                            {r.payable_changed_by ? (
                              <span className="ml-1 text-[#1d4ed8] night:text-sky-300">
                                ✎
                              </span>
                            ) : null}
                          </td>
                          <td className={cn(TD, "text-right")}>
                            {money(r.difference)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-[#efeee8] font-semibold night:bg-white/[.06]">
                        <td className={TD} colSpan={5}>
                          Total · {rows.length}{" "}
                          {rows.length === 1 ? "order" : "orders"}
                        </td>
                        <td className={TD}>{sum(rows, (r) => r.adults)}</td>
                        <td className={TD}>{sum(rows, (r) => r.children)}</td>
                        <td className={TD} colSpan={2} />
                        <td className={cn(TD, "text-right")}>
                          {money(sum(rows, (r) => r.guest_paid))}
                        </td>
                        <td className={cn(TD, "text-right")}>
                          {money(sum(rows, (r) => r.payable))}
                        </td>
                        <td className={cn(TD, "text-right")}>
                          {money(sum(rows, (r) => r.difference))}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <HowToUse
            title="How to use — Farm out Report"
            items={[
              "The page shows the orders farmed out to partner bus companies, this month by default.",
              "For other days: 📅 → Yesterday, This Week or This Month, or Custom (pick both dates, then Apply).",
              "Pick a partner to see only that company.",
              "Difference is Guest paid minus Payable. ✎ next to a Payable amount means staff changed it; hover to see who and when.",
              "Click Export CSV to download every row for these filters (opens in Excel).",
            ]}
          />
        </>
      )}
    </main>
  );
}
