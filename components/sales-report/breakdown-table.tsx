"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  type BreakdownMetric,
  type BreakdownPeriod,
  fetchProductAgents,
  type PeriodSpec,
  type ProductAgentsResponse,
} from "@/lib/sales-breakdown-api";
import {
  ALL_METRICS,
  cellOf,
  type Merged,
  type MergedAgent,
  mergeAgents,
  type MergedGroup,
  type MergedProduct,
  type MergedSection,
  totalOf,
  type Vals,
} from "@/lib/sales-breakdown";
import { cn } from "@/lib/utils";

/** All three 的三种排法：每个产品三行（默认）/ 每个期间三个子列 / 只看合计。 */
export type Layout = "rows" | "cols" | "totals";

export const METRIC_LABEL: Record<BreakdownMetric, string> = {
  orders: "Orders",
  pax: "Pax",
  amount: "$ Amount",
};
/** 指标名旁的口径小标记。 */
const METRIC_MARK: Record<BreakdownMetric, string> = {
  orders: "incl. pending",
  pax: "incl. pending",
  amount: "confirmed",
};
const METRIC_DOT: Record<BreakdownMetric, string> = {
  orders: "bg-[#6d5bd0]",
  pax: "bg-[#2f8f6b]",
  amount: "bg-[#ba7517]",
};

/** 金额是美元（小数）：$1,003,218.13；其余是整数。 */
export function formatValue(v: number, metric: BreakdownMetric): string {
  return metric === "amount"
    ? `$${v.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : v.toLocaleString("en-US");
}

function Num({
  v,
  metric,
  failed,
}: {
  v: number;
  metric: BreakdownMetric;
  failed: boolean;
}) {
  if (failed) return <>—</>;
  return v === 0 ? (
    <span className="font-normal text-[#a29a8f] night:text-white/35">
      {formatValue(v, metric)}
    </span>
  ) : (
    <>{formatValue(v, metric)}</>
  );
}

const TD =
  "border-b-[0.5px] border-black/10 px-2.5 py-[5px] text-right whitespace-nowrap";
const LBL =
  "sticky left-0 z-[1] min-w-[230px] max-w-[300px] whitespace-normal border-b-[0.5px] border-black/10 px-2.5 py-[5px] text-left align-top shadow-[1px_0_0_rgba(0,0,0,.1)]";
const TOT = "border-l-[0.5px] border-black/10 font-semibold";

type RowKind =
  "group" | "section" | "product" | "agent" | "agent-sum" | "grand" | "cat";

const ROW_BG: Record<RowKind, string> = {
  group: "bg-[#ece8e1] font-bold",
  section: "bg-[#f6f4f0] text-[12px] font-semibold",
  product: "bg-paper",
  agent: "bg-[#f7f4ef] text-[12px]",
  "agent-sum": "bg-[#f7f4ef] text-[12px] font-semibold",
  grand: "bg-[#1a1a1a] font-bold text-white",
  cat: "bg-paper text-[11.5px] text-[#6b5e57]",
};

interface Ctx {
  metrics: readonly BreakdownMetric[];
  /** 请求失败的指标：格子显示 —。 */
  failed: ReadonlySet<BreakdownMetric>;
  layout: Layout;
  periods: BreakdownPeriod[];
}

/**
 * 一个“实体”（Group / section / 产品 / agent / 合计）按版式输出几行：
 * 单个指标 = 一行；All three：rows = 每个指标一行（名称格合并），cols = 一行里每期三个子列，totals = 一行三个合计。
 */
function EntityRows({
  ctx,
  kind,
  label,
  vals,
  onClick,
  open,
  rowKey,
  attrs,
}: {
  ctx: Ctx;
  kind: RowKind;
  label: React.ReactNode;
  vals: Vals;
  onClick?: () => void;
  open?: boolean;
  rowKey: string;
  attrs?: Record<string, string>;
}) {
  const { metrics, failed, layout, periods } = ctx;
  const bg = cn(
    ROW_BG[kind],
    open && "bg-[#f1ede6]",
    onClick && "cursor-pointer",
  );
  const trProps = {
    className: bg,
    onClick,
    ...attrs,
  };
  const lbl = (span?: number) => (
    <td
      className={cn(
        LBL,
        bg,
        kind === "agent" || kind === "agent-sum" ? "pl-[52px]" : "",
      )}
      rowSpan={span}
      data-lbl
    >
      {label}
    </td>
  );
  const cellFor = (m: BreakdownMetric, key: string) => (
    <Num v={cellOf(vals[m], key)} metric={m} failed={failed.has(m)} />
  );
  const totalFor = (m: BreakdownMetric) => (
    <Num v={totalOf(vals[m])} metric={m} failed={failed.has(m)} />
  );

  if (metrics.length === 1 || layout === "cols") {
    const single = metrics.length === 1;
    return (
      <tr key={rowKey} {...trProps}>
        {lbl()}
        {periods.map((p) =>
          metrics.map((m, k) => (
            <td
              key={`${p.key}-${m}`}
              className={cn(TD, bg, !single && k === 0 && "border-l-[0.5px]")}
              data-metric={m}
            >
              {cellFor(m, p.key)}
            </td>
          )),
        )}
        {metrics.map((m, k) => (
          <td
            key={`tot-${m}`}
            className={cn(TD, bg, TOT, !single && k > 0 && "border-l-0")}
            data-total={m}
          >
            {totalFor(m)}
          </td>
        ))}
      </tr>
    );
  }
  if (layout === "totals") {
    return (
      <tr key={rowKey} {...trProps}>
        {lbl()}
        {metrics.map((m) => (
          <td key={m} className={cn(TD, bg, TOT)} data-total={m}>
            {totalFor(m)}
          </td>
        ))}
      </tr>
    );
  }
  // rows
  return (
    <Fragment key={rowKey}>
      {metrics.map((m, k) => (
        <tr key={m} {...trProps} data-metric-row={m}>
          {k === 0 ? lbl(metrics.length) : null}
          <td
            className={cn(
              TD,
              bg,
              "min-w-[118px] text-left text-[11px] text-[#6b5e57]",
              kind === "grand" && "text-white/70",
            )}
          >
            <span
              className={cn(
                "mr-1.5 inline-block size-[7px] rounded-full",
                METRIC_DOT[m],
              )}
            />
            {METRIC_LABEL[m]}
            <span className="ml-1 text-[10px] opacity-70">
              {METRIC_MARK[m]}
            </span>
          </td>
          {periods.map((p) => (
            <td key={p.key} className={cn(TD, bg)} data-metric={m}>
              {cellFor(m, p.key)}
            </td>
          ))}
          <td className={cn(TD, bg, TOT)} data-total={m}>
            {totalFor(m)}
          </td>
        </tr>
      ))}
    </Fragment>
  );
}

const KIND_TAG =
  "ml-1.5 rounded-[8px] border border-[#c9c2b8] px-1.5 text-[9.5px] font-medium whitespace-nowrap text-[#6b5e57]";
const PEND_TAG =
  "ml-1.5 rounded-[8px] border border-[#e0b36a] bg-[#fff4dc] px-1.5 text-[9.5px] font-medium whitespace-nowrap text-[#8a5a00]";

export function BreakdownTable({
  merged,
  metrics,
  failed,
  layout,
  spec,
  specKey,
  collapsed,
  open,
  onToggleGroup,
  onToggleProduct,
  onUnauthorized,
}: {
  merged: Merged;
  metrics: readonly BreakdownMetric[];
  failed: ReadonlySet<BreakdownMetric>;
  layout: Layout;
  spec: PeriodSpec;
  /** 周期 + 指标变化就换 key，agent 缓存跟着清掉。 */
  specKey: string;
  collapsed: ReadonlySet<string>;
  open: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  onToggleProduct: (key: string) => void;
  onUnauthorized: () => void;
}) {
  const all = metrics.length > 1;
  const L: Layout = all ? layout : "rows";
  const ctx: Ctx = { metrics, failed, layout: L, periods: merged.periods };
  const { periods } = merged;
  const colCount =
    L === "totals"
      ? 1 + metrics.length
      : L === "cols" || !all
        ? 1 + periods.length * metrics.length + metrics.length
        : 2 + periods.length + 1;

  const TH =
    "sticky top-0 z-[2] border-b border-black/[.08] bg-[#faf8f5] px-2.5 py-[7px] text-right font-semibold whitespace-nowrap text-[#1a1a1a]";
  const periodHead = (p: BreakdownPeriod) => p.label;

  return (
    <div className="overflow-x-auto rounded-[10px] border-[0.5px] border-black/10">
      <table className="w-full border-separate border-spacing-0 text-[12.5px] text-[#1a1a1a] tabular-nums">
        <thead>
          {L === "totals" ? (
            <tr>
              <th className={cn(TH, "left-0 z-[3] text-left")}>
                Group / section / product
              </th>
              {metrics.map((m) => (
                <th key={m} className={cn(TH, TOT)}>
                  {METRIC_LABEL[m]}
                  <div className="text-[10px] font-normal text-[#8a847c]">
                    {METRIC_MARK[m]}
                  </div>
                </th>
              ))}
            </tr>
          ) : all && L === "cols" ? (
            <>
              <tr>
                <th rowSpan={2} className={cn(TH, "left-0 z-[3] text-left")}>
                  Group / section / product
                </th>
                {periods.map((p) => (
                  <th
                    key={p.key}
                    colSpan={metrics.length}
                    className={cn(
                      TH,
                      "border-l-[0.5px] border-black/10 text-center",
                    )}
                  >
                    {periodHead(p)}
                  </th>
                ))}
                <th
                  colSpan={metrics.length}
                  className={cn(TH, TOT, "text-center")}
                >
                  Total
                </th>
              </tr>
              <tr>
                {[...periods, null].flatMap((p) =>
                  metrics.map((m, k) => (
                    <th
                      key={`${p?.key ?? "t"}-${m}`}
                      className={cn(
                        TH,
                        "top-[28px] text-[11px] font-medium text-[#6b5e57]",
                        k === 0 && "border-l-[0.5px] border-black/10",
                      )}
                    >
                      {m === "amount" ? "$" : METRIC_LABEL[m]}
                    </th>
                  )),
                )}
              </tr>
            </>
          ) : (
            <tr>
              <th className={cn(TH, "left-0 z-[3] text-left")}>
                Group / section / product
              </th>
              {all ? <th className={cn(TH, "text-left")}>Count</th> : null}
              {periods.map((p) => (
                <th key={p.key} className={TH}>
                  {periodHead(p)}
                </th>
              ))}
              <th className={cn(TH, TOT)}>Total</th>
            </tr>
          )}
        </thead>
        <tbody>
          {merged.groups.map((g) => (
            <GroupRows
              key={g.key}
              g={g}
              ctx={ctx}
              metrics={metrics}
              collapsed={collapsed.has(g.key)}
              open={open}
              onToggleGroup={onToggleGroup}
              onToggleProduct={onToggleProduct}
              spec={spec}
              specKey={specKey}
              colCount={colCount}
              onUnauthorized={onUnauthorized}
            />
          ))}
          <EntityRows
            ctx={ctx}
            kind="grand"
            rowKey="grand"
            label="Grand total"
            vals={merged.grand}
          />
          {merged.byCategory.map((c, i) => (
            <EntityRows
              key={c.code}
              ctx={ctx}
              kind="cat"
              rowKey={`cat-${c.code}`}
              vals={c.vals}
              label={
                <>
                  {i === 0 ? (
                    <span className="block text-[10px] tracking-[0.05em] text-[#9b8f88] uppercase">
                      For checking against the old report
                    </span>
                  ) : null}
                  {c.label}
                </>
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  g,
  ctx,
  metrics,
  collapsed,
  open,
  onToggleGroup,
  onToggleProduct,
  spec,
  specKey,
  colCount,
  onUnauthorized,
}: {
  g: MergedGroup;
  ctx: Ctx;
  metrics: readonly BreakdownMetric[];
  collapsed: boolean;
  open: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  onToggleProduct: (key: string) => void;
  spec: PeriodSpec;
  specKey: string;
  colCount: number;
  onUnauthorized: () => void;
}) {
  return (
    <>
      <EntityRows
        ctx={ctx}
        kind="group"
        rowKey={`g-${g.key}`}
        vals={g.vals}
        onClick={() => onToggleGroup(g.key)}
        attrs={{ "data-group": g.name }}
        label={
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={(e) => {
              e.stopPropagation();
              onToggleGroup(g.key);
            }}
            className="flex cursor-pointer items-baseline gap-1.5 text-left font-bold"
          >
            <span className="w-3">{collapsed ? "▸" : "▾"}</span> {g.name}
          </button>
        }
      />
      {collapsed
        ? null
        : g.sections.map((s) => (
            <SectionRows
              key={s.key}
              g={g}
              s={s}
              ctx={ctx}
              metrics={metrics}
              open={open}
              onToggleProduct={onToggleProduct}
              spec={spec}
              specKey={specKey}
              colCount={colCount}
              onUnauthorized={onUnauthorized}
            />
          ))}
    </>
  );
}

function SectionRows({
  g,
  s,
  ctx,
  metrics,
  open,
  onToggleProduct,
  spec,
  specKey,
  colCount,
  onUnauthorized,
}: {
  g: MergedGroup;
  s: MergedSection;
  ctx: Ctx;
  metrics: readonly BreakdownMetric[];
  open: ReadonlySet<string>;
  onToggleProduct: (key: string) => void;
  spec: PeriodSpec;
  specKey: string;
  colCount: number;
  onUnauthorized: () => void;
}) {
  // 非 tour 的 kind 总是标；同名 section 因 kind 不同重复时 tour 也标，免得看不出区别。
  const dup = g.sections.filter((x) => x.title === s.title).length > 1;
  const showKind = s.kind !== "tour" || dup;
  return (
    <>
      {g.hasSections ? (
        <EntityRows
          ctx={ctx}
          kind="section"
          rowKey={`s-${s.key}`}
          vals={s.vals}
          attrs={{ "data-section": s.title }}
          label={
            <span className="pl-4">
              {s.title}
              {showKind ? (
                <>
                  {" "}
                  <span className={KIND_TAG}>{s.kind}</span>
                </>
              ) : null}
            </span>
          }
        />
      ) : null}
      {s.products.map((p) => (
        <ProductRows
          key={p.key}
          p={p}
          g={g}
          ctx={ctx}
          metrics={metrics}
          isOpen={open.has(p.key)}
          onToggle={() => onToggleProduct(p.key)}
          spec={spec}
          specKey={specKey}
          colCount={colCount}
          onUnauthorized={onUnauthorized}
        />
      ))}
    </>
  );
}

function ProductRows({
  p,
  g,
  ctx,
  metrics,
  isOpen,
  onToggle,
  spec,
  specKey,
  colCount,
  onUnauthorized,
}: {
  p: MergedProduct;
  g: MergedGroup;
  ctx: Ctx;
  metrics: readonly BreakdownMetric[];
  isOpen: boolean;
  onToggle: () => void;
  spec: PeriodSpec;
  specKey: string;
  colCount: number;
  onUnauthorized: () => void;
}) {
  // 只在 Orders / Pax 里有、$ 里没有（全是 pending，$ 的接口把它隐藏了）：补 0 并标出来，免得以为数据丢了。
  const pendingOnly =
    metrics.includes("amount") &&
    !ctx.failed.has("amount") &&
    !p.vals.amount &&
    !!(p.vals.orders || p.vals.pax);
  return (
    <>
      <EntityRows
        ctx={ctx}
        kind="product"
        rowKey={`p-${p.key}`}
        vals={p.vals}
        open={isOpen}
        onClick={onToggle}
        attrs={{ "data-product": p.code || p.label }}
        label={
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={cn(
              "cursor-pointer text-left",
              g.hasSections ? "pl-8" : "pl-4",
            )}
          >
            {p.label}{" "}
            <span className="ml-1.5 font-mono text-[10.5px] text-[#8a847c]">
              {p.code || "(no product code)"}
            </span>
            {p.inProducts ? null : (
              <>
                {" "}
                <span className={KIND_TAG}>not in Products</span>
              </>
            )}
            {pendingOnly ? (
              <>
                {" "}
                <span
                  className={PEND_TAG}
                  title="Only in Orders and Pax. The $ table hides it because nothing is confirmed."
                >
                  pending only
                </span>
              </>
            ) : null}
          </button>
        }
      />
      {isOpen ? (
        <AgentRows
          p={p}
          ctx={ctx}
          metrics={metrics}
          spec={spec}
          specKey={specKey}
          colCount={colCount}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </>
  );
}

type AgentState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      agents: MergedAgent[];
      grand: Vals;
      missing: BreakdownMetric[];
    };

/** 点开一个产品：它按 agent 拆（每个指标各请求一次，按 agent 名对齐）。 */
function AgentRows({
  p,
  ctx,
  metrics,
  spec,
  specKey,
  colCount,
  onUnauthorized,
}: {
  p: MergedProduct;
  ctx: Ctx;
  metrics: readonly BreakdownMetric[];
  spec: PeriodSpec;
  specKey: string;
  colCount: number;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<AgentState>({ kind: "loading" });
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const [retry, setRetry] = useState(0);
  const code = p.code;

  useEffect(() => {
    if (!code) {
      setState({ kind: "ready", agents: [], grand: {}, missing: [] });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    const wanted = metrics.filter((m) => !ctx.failed.has(m));
    Promise.allSettled(
      wanted.map((m) => fetchProductAgents(spec, m, code, controller.signal)),
    ).then((settled) => {
      if (controller.signal.aborted) return;
      const ok: Partial<Record<BreakdownMetric, ProductAgentsResponse>> = {};
      const missing: BreakdownMetric[] = [];
      let firstError: unknown = null;
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") ok[wanted[i]] = r.value;
        else {
          missing.push(wanted[i]);
          firstError ??= r.reason;
        }
      });
      if (firstError && isStatus(firstError, 401)) {
        unauthorizedRef.current();
        return;
      }
      if (!Object.keys(ok).length) {
        setState({
          kind: "error",
          message: describeError(firstError ?? new Error("No response")),
        });
        return;
      }
      const merged = mergeAgents(ok);
      setState({ kind: "ready", ...merged, missing });
    });
    return () => controller.abort();
    // specKey 变了（周期 / 指标）就重取；spec 对象本身每次渲染是同一个值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, specKey, retry]);

  const note = (text: React.ReactNode, tone = "") => (
    <tr className="bg-[#f7f4ef]" data-agents={code}>
      <td
        colSpan={colCount}
        className={cn(
          "sticky left-0 border-b-[0.5px] border-black/10 py-2 pl-[52px] text-left text-[12px]",
          tone,
        )}
      >
        {text}
      </td>
    </tr>
  );

  if (state.kind === "loading")
    return note("Loading agents…", "text-[#6b5e57]");
  if (state.kind === "error")
    return note(
      <>
        Could not load agents: {state.message}{" "}
        <button
          type="button"
          onClick={() => setRetry((n) => n + 1)}
          className="ml-1 cursor-pointer rounded-md border-[0.5px] border-black/30 px-2 py-px text-[11px]"
        >
          Retry
        </button>
      </>,
      "text-[#A32D2D]",
    );
  if (!state.agents.length)
    return note(
      "No bookings for this product in this range.",
      "text-[#6b5e57]",
    );

  return (
    <>
      {state.missing.length
        ? note(
            <>
              {state.missing.map((m) => METRIC_LABEL[m]).join(", ")} could not
              load for agents.{" "}
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="ml-1 cursor-pointer rounded-md border-[0.5px] border-black/30 px-2 py-px text-[11px]"
              >
                Retry
              </button>
            </>,
            "text-[#A32D2D]",
          )
        : null}
      {state.agents.map((a) => (
        <EntityRows
          key={a.agent}
          ctx={{ ...ctx, failed: new Set([...ctx.failed, ...state.missing]) }}
          kind="agent"
          rowKey={`a-${code}-${a.agent}`}
          vals={a.vals}
          attrs={{ "data-agent": a.agent }}
          label={a.agent}
        />
      ))}
      <EntityRows
        ctx={{ ...ctx, failed: new Set([...ctx.failed, ...state.missing]) }}
        kind="agent-sum"
        rowKey={`as-${code}`}
        vals={state.grand}
        attrs={{ "data-agent-total": code }}
        label="All agents"
      />
    </>
  );
}

export { ALL_METRICS };
