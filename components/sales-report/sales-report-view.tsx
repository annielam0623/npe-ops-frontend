"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FILTER_BAR_CLASS,
  FILTER_BUTTON_CLASS,
  FilterDivider,
  FilterSelect,
  Segmented,
} from "@/components/ui/filter-bar";
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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            System
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">
            Sales Report
          </h1>
        </header>

        <div className={FILTER_BAR_CLASS}>
          <FilterSelect
            label="Year"
            value={String(period?.year ?? "")}
            onChange={(v) =>
              setPeriod((p) => (p ? { ...p, year: Number(v) } : p))
            }
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Month"
            value={String(period?.month ?? "")}
            onChange={(v) =>
              setPeriod((p) => (p ? { ...p, month: Number(v) } : p))
            }
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </FilterSelect>
          <FilterDivider />
          <Segmented
            label="Count"
            value={metric}
            options={METRICS}
            onChange={setMetric}
          />
        </div>

        <div role="tablist" className="flex gap-1 border-b border-stone-300">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
                tab === t.value
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-500 hover:text-stone-800",
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

        <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
          <summary className="cursor-pointer font-semibold text-sky-900">
            📖 How to use — Sales Report
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Pick the year (all tables) and the month (weekly tables only).
            </li>
            <li>Choose Orders or Pax, and the Bus Tour or Tickets tab.</li>
            <li>
              Counted by tour date; cancelled bookings are left out. No agent
              shows as Direct.
            </li>
            <li>
              Weekly columns are days of the month: W1 is the 1st–7th, W2 the
              8th–14th, and so on.
            </li>
            <li>
              Click ⬇ Export on a table to download it as a CSV (opens in
              Excel).
            </li>
          </ol>
        </details>
      </div>
    </main>
  );
}

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
      className="overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          {title}
          {pivot?.subtitle ? (
            <span className="ml-2 font-normal tracking-normal text-stone-400 normal-case">
              {pivot.subtitle}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={exportCsv}
          disabled={empty}
          className={FILTER_BUTTON_CLASS}
        >
          ⬇ Export
        </button>
      </div>
      {state.kind === "loading" ? (
        <p className="px-4 py-8 text-center text-sm text-stone-400">
          Loading...
        </p>
      ) : state.kind === "error" ? (
        <p role="alert" className="px-4 py-8 text-center text-sm text-red-700">
          Failed to load: {state.message}
        </p>
      ) : empty ? (
        <p className="px-4 py-8 text-center text-sm text-stone-400">No data</p>
      ) : (
        <PivotTable pivot={state.data} />
      )}
    </section>
  );
}

function PivotTable({ pivot }: { pivot: SalesPivot }) {
  const t = totals(pivot);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
            <th className="px-3 py-2 text-left font-semibold">Agent</th>
            {pivot.columnNames.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-semibold">
                {c}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.agent} className="border-b border-stone-100">
              <td className="px-3 py-1.5 text-left">
                {r.agent || <i className="text-stone-400">(blank)</i>}
              </td>
              {r.values.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-3 py-1.5 text-right",
                    v === 0 && "text-stone-300",
                  )}
                >
                  {v === 0 ? "—" : v.toLocaleString("en-US")}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-semibold">
                {r.total.toLocaleString("en-US")}
              </td>
            </tr>
          ))}
          <tr className="border-t border-stone-300 bg-stone-50 font-semibold">
            <td className="px-3 py-1.5 text-left">Total</td>
            {t.colTotals.map((v, i) => (
              <td key={i} className="px-3 py-1.5 text-right">
                {v.toLocaleString("en-US")}
              </td>
            ))}
            <td className="px-3 py-1.5 text-right">
              {t.grand.toLocaleString("en-US")}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
