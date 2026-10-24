"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { downloadCsv } from "@/lib/csv";
import { laToday } from "@/lib/la-date";
import {
  ALL_METRICS,
  cellOf,
  type Merged,
  mergeBreakdowns,
  totalOf,
  type Vals,
} from "@/lib/sales-breakdown";
import {
  type BreakdownMetric,
  type BreakdownResponse,
  fetchBreakdown,
  type PeriodSpec,
} from "@/lib/sales-breakdown-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

import { BreakdownTable, type Layout, METRIC_LABEL } from "./breakdown-table";

type MetricChoice = BreakdownMetric | "all";
type Mode = PeriodSpec["mode"];

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      responses: Partial<Record<BreakdownMetric, BreakdownResponse>>;
      /** 失败的指标 → 后端原话（All three 里一个失败，其余照常显示）。 */
      errors: Partial<Record<BreakdownMetric, string>>;
    };

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
const FIRST_YEAR = 2024;

const METRIC_OPTIONS: readonly { value: MetricChoice; label: string }[] = [
  { value: "orders", label: "Orders" },
  { value: "pax", label: "Pax" },
  { value: "amount", label: "$ Amount" },
  { value: "all", label: "All three" },
];
const LAYOUT_OPTIONS: readonly { value: Layout; label: string }[] = [
  { value: "rows", label: "3 rows per product" },
  { value: "cols", label: "3 columns per period" },
  { value: "totals", label: "Totals only" },
];
const MODE_OPTIONS: readonly { value: Mode; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
];

const SELECT =
  "h-8 cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-paper px-2.5 text-[13px] text-[#1a1a1a] focus:outline-none night:border-white/10 night:bg-white/[.04] night:text-white/90";
const SEG =
  "flex flex-wrap overflow-hidden rounded-[7px] border-[0.5px] border-black/15 night:border-white/10";
const LABEL =
  "mb-1 text-[10px] font-bold tracking-[0.07em] text-[#9b8f88] uppercase";
const SMALL_BTN =
  "cursor-pointer rounded-md border-[0.5px] border-black/20 bg-paper px-3 py-1 text-[12px] text-[#1a1a1a] hover:bg-[#f5f5f3] disabled:cursor-not-allowed disabled:opacity-60 night:border-white/10 night:bg-white/[.04] night:text-white/75";

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={SEG}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 cursor-pointer px-3.5 text-[13px] transition-colors duration-100",
            value === o.value
              ? "bg-[#1a1a1a] text-white"
              : "bg-paper text-[#1a1a1a] night:bg-white/[.04] night:text-white/75",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function specKeyOf(spec: PeriodSpec): string {
  return JSON.stringify(spec);
}

/** 一个格子的 CSV 值：金额保留两位小数的纯数字，方便 Excel 求和。 */
function csvNum(v: number, metric: BreakdownMetric): number {
  return metric === "amount" ? Number(v.toFixed(2)) : v;
}

const CSV_HEAD: Record<BreakdownMetric, string> = {
  orders: "Orders (incl. pending)",
  pax: "Pax (incl. pending)",
  amount: "$ Amount (USD, confirmed)",
};

/** 一张表导出：Row type 列区分 Group / Section / Product / Grand total；每个期间后面每个指标一列。 */
function buildBreakdownCsv(
  merged: Merged,
  metrics: readonly BreakdownMetric[],
  failed: ReadonlySet<BreakdownMetric>,
) {
  const headers: string[] = [
    "Row type",
    "Group",
    "Section",
    "Section kind",
    "Product code",
    "Product",
  ];
  for (const p of merged.periods) {
    for (const m of metrics) headers.push(`${p.label} ${CSV_HEAD[m]}`);
  }
  for (const m of metrics) headers.push(`Total ${CSV_HEAD[m]}`);

  const line = (
    type: string,
    group: string,
    section: string,
    kind: string,
    code: string,
    product: string,
    vals: Vals,
  ): (string | number)[] => {
    const row: (string | number)[] = [
      type,
      group,
      section,
      kind,
      code,
      product,
    ];
    for (const p of merged.periods) {
      for (const m of metrics) {
        row.push(failed.has(m) ? "" : csvNum(cellOf(vals[m], p.key), m));
      }
    }
    for (const m of metrics) {
      row.push(failed.has(m) ? "" : csvNum(totalOf(vals[m]), m));
    }
    return row;
  };

  const rows: (string | number)[][] = [];
  for (const g of merged.groups) {
    rows.push(line("Group", g.name, "", "", "", "", g.vals));
    for (const s of g.sections) {
      if (g.hasSections) {
        rows.push(line("Section", g.name, s.title, s.kind, "", "", s.vals));
      }
      for (const p of s.products) {
        rows.push(
          line("Product", g.name, s.title, s.kind, p.code, p.label, p.vals),
        );
      }
    }
  }
  rows.push(line("Grand total", "", "", "", "", "", merged.grand));
  return { headers, rows };
}

export function BreakdownView() {
  const [today] = useState(() => laToday());
  const [ty, tm] = useMemo(() => today.split("-").map(Number), [today]);
  const [metric, setMetric] = useState<MetricChoice>("all");
  const [layout, setLayout] = useState<Layout>("rows");
  const [mode, setMode] = useState<Mode>("week");
  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm);
  const [years, setYears] = useState(3);
  const [start, setStart] = useState(`${ty}-${String(tm).padStart(2, "0")}-01`);
  const [end, setEnd] = useState(today);
  const [bucket, setBucket] = useState<"none" | "week" | "month">("none");
  const [applied, setApplied] = useState({
    start: `${ty}-${String(tm).padStart(2, "0")}-01`,
    end: today,
    bucket: "none" as "none" | "week" | "month",
  });
  const [formError, setFormError] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const spec: PeriodSpec = useMemo(() => {
    switch (mode) {
      case "week":
        return { mode, year, month };
      case "month":
      case "quarter":
        return { mode, year };
      case "year":
        return { mode, year, years };
      case "custom":
        return { mode, ...applied };
    }
  }, [mode, year, month, years, applied]);
  const metrics: readonly BreakdownMetric[] =
    metric === "all" ? ALL_METRICS : [metric];
  const key = `${specKeyOf(spec)}|${metrics.join(",")}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    Promise.allSettled(
      metrics.map((m) => fetchBreakdown(spec, m, controller.signal)),
    ).then((settled) => {
      if (controller.signal.aborted) return;
      const responses: Partial<Record<BreakdownMetric, BreakdownResponse>> = {};
      const errors: Partial<Record<BreakdownMetric, string>> = {};
      let unauthorized = false;
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") responses[metrics[i]] = r.value;
        else if (isStatus(r.reason, 401)) unauthorized = true;
        else errors[metrics[i]] = describeError(r.reason);
      });
      if (unauthorized) {
        redirectToLogin();
        return;
      }
      if (!Object.keys(responses).length) {
        setLoad({
          kind: "error",
          message: Object.values(errors)[0] ?? "Could not load.",
        });
        return;
      }
      setLoad({ kind: "ready", responses, errors });
    });
    return () => controller.abort();
    // key 按值比较周期 + 指标；reloadKey 是 Retry。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);

  const merged = useMemo(
    () => (load.kind === "ready" ? mergeBreakdowns(load.responses) : null),
    [load],
  );
  const failed = useMemo(
    () =>
      new Set<BreakdownMetric>(
        load.kind === "ready"
          ? (Object.keys(load.errors) as BreakdownMetric[])
          : [],
      ),
    [load],
  );

  function show() {
    if (!start || !end) {
      setFormError("Pick both a start date and an end date.");
      return;
    }
    if (start > end) {
      setFormError("The start date is after the end date.");
      return;
    }
    setFormError("");
    setApplied({ start, end, bucket });
  }

  const toggle = (set: ReadonlySet<string>, k: string) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  };

  const anyGroups = merged?.groups.length ?? 0;
  const allZero =
    !!merged &&
    Object.values(merged.grand).every((n) => !n || totalOf(n) === 0);

  function exportCsv() {
    if (!merged) return;
    const csv = buildBreakdownCsv(merged, metrics, failed);
    const range =
      load.kind === "ready"
        ? (Object.values(load.responses)[0]?.range ?? null)
        : null;
    const name = `sales-report_${range ? `${range.start}_${range.end}` : today}_${metric === "all" ? "all-three" : metric}.csv`;
    downloadCsv(name, csv.headers, csv.rows);
  }

  const yearOptions: number[] = [];
  for (let y = ty + 1; y >= FIRST_YEAR; y--) yearOptions.push(y);

  const range =
    load.kind === "ready" ? Object.values(load.responses)[0]?.range : undefined;
  const responses = load.kind === "ready" ? load.responses : {};

  return (
    <>
      <section
        aria-label="Sales by group"
        className="mb-4 rounded-[10px] border-[0.5px] border-black/10 bg-paper px-5 py-[18px] night:border-white/10 night:bg-white/[.04]"
      >
        <div className={LABEL}>Count</div>
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <Seg
            label="Count"
            value={metric}
            options={METRIC_OPTIONS}
            onChange={setMetric}
          />
          {metric === "all" ? (
            <Seg
              label="Table layout"
              value={layout}
              options={LAYOUT_OPTIONS}
              onChange={setLayout}
            />
          ) : null}
        </div>

        <div className={LABEL}>Period</div>
        <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2">
          <Seg
            label="Period type"
            value={mode}
            options={MODE_OPTIONS}
            onChange={(m) => {
              setMode(m);
              setFormError("");
            }}
          />
          {mode === "week" ||
          mode === "month" ||
          mode === "quarter" ||
          mode === "year" ? (
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6b5e57]">
              {mode === "year" ? "Last year" : "Year"}
              <select
                aria-label="Year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={SELECT}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {mode === "week" ? (
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6b5e57]">
              Month
              <select
                aria-label="Month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={SELECT}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {mode === "year" ? (
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6b5e57]">
              Years shown
              <select
                aria-label="Years shown"
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                className={SELECT}
              >
                {[1, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {mode === "custom" ? (
            <>
              <label className="flex flex-col gap-0.5 text-[11px] text-[#6b5e57]">
                Start date
                <input
                  type="date"
                  aria-label="Start date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className={SELECT}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-[#6b5e57]">
                End date
                <input
                  type="date"
                  aria-label="End date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className={SELECT}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-[#6b5e57]">
                Columns
                <select
                  aria-label="Columns"
                  value={bucket}
                  onChange={(e) =>
                    setBucket(e.target.value as "none" | "week" | "month")
                  }
                  className={SELECT}
                >
                  <option value="none">One Total column</option>
                  <option value="week">By week (W1–W5 of each month)</option>
                  <option value="month">By month</option>
                </select>
              </label>
              <button
                type="button"
                onClick={show}
                className="h-8 cursor-pointer rounded-[7px] bg-[#3b82f6] px-4 text-[13px] font-medium text-white hover:brightness-95"
              >
                Show
              </button>
            </>
          ) : null}
        </div>
        {formError ? (
          <p
            role="alert"
            className="mb-2 text-[12px] text-[#A32D2D] night:text-red-300"
          >
            {formError}
          </p>
        ) : null}
        {mode === "week" ? (
          <p className="mb-2 text-[11px] text-[#6b5e57]">
            W1 = 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–28, W5 = 29 to month end.
          </p>
        ) : null}

        {load.kind === "loading" ? (
          <p className="py-5 text-[13px] text-[#1a1a1a] night:text-white/35">
            Loading...
          </p>
        ) : load.kind === "error" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 py-4 text-[13px] text-[#A32D2D] night:text-red-300"
          >
            <span>Failed to load: {load.message}</span>
            <button
              type="button"
              className={SMALL_BTN}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="mb-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-[#4a4540]">
              {metric === "all" ? (
                <>
                  {responses.orders ? (
                    <span className="rounded-lg border border-[#d6d0c6] bg-[#faf8f5] px-2 py-0.5">
                      <b>Orders / Pax:</b> {responses.orders.basis}
                    </span>
                  ) : null}
                  {responses.amount ? (
                    <span className="rounded-lg border border-[#d6d0c6] bg-[#faf8f5] px-2 py-0.5">
                      <b>$ Amount:</b> {responses.amount.basis} (
                      {responses.amount.currency})
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="rounded-lg border border-[#d6d0c6] bg-[#faf8f5] px-2 py-0.5">
                    <b>Counting:</b>{" "}
                    {responses[metric as BreakdownMetric]?.basis}
                  </span>
                  <span className="rounded-lg border border-[#d6d0c6] bg-[#faf8f5] px-2 py-0.5">
                    <b>Unit:</b> {responses[metric as BreakdownMetric]?.unit}
                  </span>
                </>
              )}
              {range ? (
                <span className="rounded-lg border border-[#d6d0c6] bg-[#faf8f5] px-2 py-0.5">
                  <b>Range:</b> {range.start} → {range.end}
                </span>
              ) : null}
            </div>

            {failed.size ? (
              <div
                role="alert"
                className="mb-2.5 flex flex-wrap items-center gap-2 text-[12px] text-[#A32D2D] night:text-red-300"
              >
                <span>
                  {[...failed].map((m) => METRIC_LABEL[m]).join(", ")} could not
                  load:{" "}
                  {
                    Object.values(
                      (load as Extract<Load, { kind: "ready" }>).errors,
                    )[0]
                  }
                  . The other counts are shown.
                </span>
                <button
                  type="button"
                  className={SMALL_BTN}
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {allZero && anyGroups ? (
              <p className="mb-2.5 rounded-lg bg-[#fff4dc] px-3 py-2 text-[12px] text-[#7a4b00]">
                Nothing booked in this range yet. Active products are still
                listed, at 0.
              </p>
            ) : null}

            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={SMALL_BTN}
                disabled={!anyGroups}
                onClick={() =>
                  setCollapsed(new Set(merged?.groups.map((g) => g.key)))
                }
              >
                Collapse all groups
              </button>
              <button
                type="button"
                className={SMALL_BTN}
                disabled={!anyGroups}
                onClick={() => setCollapsed(new Set())}
              >
                Expand all groups
              </button>
              <button
                type="button"
                className={SMALL_BTN}
                disabled={!anyGroups}
                onClick={exportCsv}
              >
                ⬇ Export CSV{metric === "all" ? " (one table)" : ""}
              </button>
              <span className="ml-auto text-[11px] text-[#6b5e57]">
                Click a group to fold it. Click a product to see its agents.
              </span>
            </div>

            {merged && anyGroups ? (
              <BreakdownTable
                merged={merged}
                metrics={metrics}
                failed={failed}
                layout={layout}
                spec={spec}
                specKey={key}
                collapsed={collapsed}
                open={open}
                onToggleGroup={(k) => setCollapsed((s) => toggle(s, k))}
                onToggleProduct={(k) => setOpen((s) => toggle(s, k))}
                onUnauthorized={redirectToLogin}
              />
            ) : (
              <p className="py-4 text-center text-[13px] text-[#1a1a1a] night:text-white/35">
                No data
              </p>
            )}
          </>
        )}
      </section>
      <HowToUse
        title="How to use — Sales Report"
        items={[
          "Pick what to count: Orders, Pax, $ Amount, or All three in one table. $ Amount only counts confirmed bookings. Orders and Pax include pending ones but not cancelled ones. The lines above the table say which is which.",
          "All three: choose 3 rows per product (best for many columns and for phones), 3 columns per period, or Totals only.",
          "Pick a period: Week (a month cut into W1–W5), Month, Quarter, Year (the last 1–10 years), or Custom start and end dates. For Custom, choose one Total column or split by week or by month, then click Show.",
          "Rows follow the Manifest page: Group, then the sections inside it, then products. Products with the same name are told apart by their code. No group yet holds products that are not in a Manifest group.",
          "Orders are counted separately at every level, so a Group is not the sum of the rows under it (an order with two products counts once in its Group). Do not add them up by hand. Pax and $ do add up.",
          "Active products are always listed, even with 0. Inactive products with 0 in the range are hidden. In All three, a product is listed if any of the three counts has something.",
          "Click a product to see its agents. No agent shows as Direct.",
          "Click ⬇ Export CSV to download what the table shows as one file (opens in Excel).",
        ]}
      />
    </>
  );
}
