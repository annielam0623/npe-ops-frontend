"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { downloadCsv } from "@/lib/csv";
import { laToday } from "@/lib/la-date";
import {
  fetchMonthly,
  fetchWeekly,
  type Metric,
  type ProductType,
  type SalesPivot,
} from "@/lib/sales-report-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

type TableState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: SalesPivot };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const FIRST_YEAR = 2024;

const TABS: readonly { value: ProductType; label: string; file: string }[] = [
  { value: "bus_tour", label: "Bus Tour", file: "tour" },
  { value: "ticket", label: "Tickets", file: "tickets" },
];

const METRICS: readonly { value: Metric; label: string }[] = [
  { value: "orders", label: "Orders" },
  { value: "pax", label: "Pax" },
];

const cell = (row: Record<string, number> | undefined, col: number) =>
  row?.[String(col)] ?? 0;

/** 表格 / 导出共用：每行合计、最后一行列合计。 */
function totals(p: SalesPivot) {
  const rows = p.agents.map((a) => {
    const values = p.columns.map((c) => cell(p.data[a], c));
    return { agent: a, values, total: values.reduce((s, v) => s + v, 0) };
  });
  const colTotals = p.columns.map((_, i) =>
    rows.reduce((s, r) => s + r.values[i], 0),
  );
  return { rows, colTotals, grand: colTotals.reduce((s, v) => s + v, 0) };
}

/**
 * 只拉当前标签页的两张表（旧页面两个标签页四张表一起拉）；晚到的旧请求不会盖掉新的。
 */
function usePivot<I>(
  input: I | null,
  fetcher: (i: I, s?: AbortSignal) => Promise<SalesPivot>,
  onUnauthorized: () => void,
): TableState {
  const [state, setState] = useState<TableState>({ kind: "loading" });
  const ref = useRef(onUnauthorized);
  ref.current = onUnauthorized;
  const key = JSON.stringify(input);
  useEffect(() => {
    if (!input) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetcher(input, controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          ref.current();
          return;
        }
        setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
    // input 按值比较（key），每次渲染新建的对象不触发重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetcher]);
  return state;
}

export function SalesReportView() {
  // 年月按洛杉矶算（旧页面按浏览器本地时间）；在浏览器里算，避免服务端 / 浏览器不一致。
  const [period, setPeriod] = useState<{ year: number; month: number } | null>(
    null,
  );
  const [metric, setMetric] = useState<Metric>("orders");
  const [tab, setTab] = useState<ProductType>("bus_tour");
  const redirectingRef = useRef(false);

  useEffect(() => {
    const [y, m] = laToday().split("-").map(Number);
    setPeriod({ year: y, month: m });
  }, []);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const monthly = usePivot(
    period ? { year: period.year, productType: tab, metric } : null,
    fetchMonthly,
    redirectToLogin,
  );
  const weekly = usePivot(
    period
      ? { year: period.year, month: period.month, productType: tab, metric }
      : null,
    fetchWeekly,
    redirectToLogin,
  );

  const currentYear = period ? Number(laToday().slice(0, 4)) : FIRST_YEAR;
  const years = Array.from(
    { length: currentYear - FIRST_YEAR + 1 },
    (_, i) => currentYear - i,
  );
  const filePrefix = TABS.find((t) => t.value === tab)?.file ?? tab;

  return (
    <main className="text-stone-800">
      {/* 旧页面 .sr-controls：直接放在深色底上。 */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <select
          aria-label="Year"
          value={String(period?.year ?? "")}
          onChange={(e) =>
            setPeriod((p) => (p ? { ...p, year: Number(e.target.value) } : p))
          }
          className={SELECT}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          aria-label="Month"
          value={String(period?.month ?? "")}
          onChange={(e) =>
            setPeriod((p) => (p ? { ...p, month: Number(e.target.value) } : p))
          }
          className={SELECT}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        {/* 旧页面 .sr-toggle */}
        <div
          role="group"
          aria-label="Count"
          className="flex overflow-hidden rounded-[7px] border-[0.5px] border-black/15"
        >
          {METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={metric === m.value}
              onClick={() => setMetric(m.value)}
              className={cn(
                "h-8 cursor-pointer px-3.5 text-[13px] transition-colors duration-100",
                metric === m.value
                  ? "bg-[#1a1a1a] text-white"
                  : "bg-white text-[#555]",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 旧页面 .sr-tabs。旧版选中的字是 #1a1a1a，在深色底上看不见，这里改用 #f8fafc。 */}
      <div
        role="tablist"
        className="mb-5 flex border-b-[1.5px] border-white/10"
      >
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "-mb-[1.5px] cursor-pointer border-b-2 px-5 py-2 text-[14px] font-medium",
              tab === t.value
                ? "border-[#f8fafc] text-[#f8fafc]"
                : "border-transparent text-[#888]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <PivotCard
        title="Monthly — by Agent"
        state={monthly}
        file={`${filePrefix}_monthly`}
      />
      <PivotCard
        title="Weekly — by Agent"
        state={weekly}
        file={`${filePrefix}_weekly`}
      />

      <HowToUse
        title="How to use — Sales Report"
        items={[
          "Pick the year (all tables) and the month (weekly tables only).",
          "Choose Orders or Pax, and the Bus Tour or Tickets tab.",
          "Counted by tour date; cancelled bookings are left out. No agent shows as Direct.",
          "Weekly columns are days of the month: W1 is the 1st–7th, W2 the 8th–14th, and so on.",
          "Click ⬇ Export on a table to download it as a CSV (opens in Excel).",
        ]}
      />
    </main>
  );
}

/** 旧页面 .sr-controls select */
const SELECT =
  "h-8 cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-white px-2.5 text-[13px] text-[#1a1a1a] focus:outline-none";

/** 旧页面 .sr-card */
function PivotCard({
  title,
  state,
  file,
}: {
  title: string;
  state: TableState;
  file: string;
}) {
  const pivot = state.kind === "ready" ? state.data : null;
  const empty = !pivot || pivot.agents.length === 0;

  function exportCsv() {
    if (!pivot || empty) return;
    const t = totals(pivot);
    downloadCsv(
      `${file}_${laToday()}.csv`,
      ["Agent", ...pivot.columnNames, "Total"],
      [
        ...t.rows.map((r) => [r.agent, ...r.values, r.total]),
        ["Total", ...t.colTotals, t.grand],
      ],
    );
  }

  return (
    <section
      aria-label={title}
      className="mb-4 rounded-[10px] border-[0.5px] border-black/10 bg-white px-5 py-[18px]"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[12px] font-semibold tracking-[0.05em] text-[#888] uppercase">
          {title}
          {pivot?.subtitle ? (
            <span className="ml-1 text-[11px] font-normal tracking-normal text-[#aaa] normal-case">
              {pivot.subtitle}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={exportCsv}
          disabled={empty}
          className="cursor-pointer rounded-md border-[0.5px] border-black/20 bg-white px-3 py-1 text-[12px] text-[#444] hover:bg-[#f5f5f3] disabled:cursor-not-allowed disabled:opacity-60"
        >
          ⬇ Export
        </button>
      </div>
      {state.kind === "loading" ? (
        <p className="py-5 text-[13px] text-[#aaa]">Loading...</p>
      ) : state.kind === "error" ? (
        <p role="alert" className="py-4 text-center text-[13px] text-[#A32D2D]">
          Failed to load: {state.message}
        </p>
      ) : empty ? (
        <p className="py-4 text-center text-[13px] text-[#bbb]">No data</p>
      ) : (
        <PivotTable pivot={state.data} />
      )}
    </section>
  );
}

/** 旧页面 table.sr-table th / td。 */
const TH =
  "border-b border-black/[.08] px-2.5 py-[7px] text-right font-semibold whitespace-nowrap text-[#555] first:text-left";
const TD =
  "border-b-[0.5px] border-black/5 px-2.5 py-1.5 text-right whitespace-nowrap first:text-left first:font-medium first:text-[#444]";
const TOTAL_TD =
  "border-t-[1.5px] border-black/[.12] bg-[#f9f9f7] px-2.5 py-1.5 text-right font-semibold whitespace-nowrap text-[#1a1a1a] first:text-left first:text-[#444]";

function PivotTable({ pivot }: { pivot: SalesPivot }) {
  const t = totals(pivot);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            <th className={TH}>Agent</th>
            {pivot.columnNames.map((c) => (
              <th key={c} className={TH}>
                {c}
              </th>
            ))}
            <th className={TH}>Total</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.agent}>
              <td className={TD}>
                {r.agent || <i className="text-[#aaa]">(blank)</i>}
              </td>
              {r.values.map((v, i) => (
                <td
                  key={i}
                  className={cn(TD, v === 0 ? "text-[#ccc]" : "text-[#1a1a1a]")}
                >
                  {v === 0 ? "—" : v.toLocaleString("en-US")}
                </td>
              ))}
              <td className={cn(TD, "text-[#1a1a1a]")}>
                <strong>{r.total.toLocaleString("en-US")}</strong>
              </td>
            </tr>
          ))}
          <tr>
            <td className={TOTAL_TD}>Total</td>
            {t.colTotals.map((v, i) => (
              <td key={i} className={TOTAL_TD}>
                {v.toLocaleString("en-US")}
              </td>
            ))}
            <td className={TOTAL_TD}>{t.grand.toLocaleString("en-US")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
