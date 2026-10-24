import { apiFetch } from "@/lib/api-client";

// ── Sales Report：按 Group → section → 产品（后端 G161，2026-10-23）──────────────────────
// 口径：$ 只算 confirmed；Orders / Pax 含 pending、不含取消。Orders 各层都是后端去重算好的数，
// 不能把下层相加当上层（Group 的订单数小于下面产品相加）；amount / pax 才可以相加。
// 说明文件：后端仓库 docs/interfaces/sales-report-breakdown-2026-10-23.md。

export type BreakdownMetric = "orders" | "pax" | "amount";

export interface BreakdownPeriod {
  key: string;
  label: string;
  start: string;
  end: string;
}

/** 格子：键是 period.key；total 是该行各期格子之和。amount 是美元（小数）。 */
export interface BreakdownNode {
  total: number;
  data: Record<string, number>;
}

export interface BreakdownProduct extends BreakdownNode {
  product_code: string;
  label: string;
  category_code: string | null;
  /** false = 产品不在 Products 表里，label 是 Rezdy 订单上的名字。 */
  in_products: boolean;
}

export interface BreakdownSection extends BreakdownNode {
  title: string;
  /** tour / outbound / inbound / roundtrip；同一 Group 里同名 section 可因 kind 不同重复。 */
  kind: string;
  products: BreakdownProduct[];
}

export interface BreakdownGroup extends BreakdownNode {
  /** null = 没归组（"No group yet"，放最后一段）。 */
  group_id: number | null;
  group_name: string;
  category_code: string | null;
  /** false = Group 下只有一节，不画 section 小标题。 */
  has_sections: boolean;
  sections: BreakdownSection[];
}

export interface BreakdownResponse {
  metric: BreakdownMetric;
  unit: string;
  /** 英文短句，写在表头附近。 */
  basis: string;
  currency: string;
  range: { start: string; end: string };
  periods: BreakdownPeriod[];
  groups: BreakdownGroup[];
  grand_total: BreakdownNode;
  by_category: (BreakdownNode & { code: string; label: string })[];
}

export interface BreakdownAgent extends BreakdownNode {
  agent: string;
}

export interface ProductAgentsResponse {
  metric: BreakdownMetric;
  unit: string;
  basis: string;
  periods: BreakdownPeriod[];
  product_code: string;
  label: string;
  agents: BreakdownAgent[];
  grand_total: BreakdownNode;
}

/** 周期：周 / 月 / 季 / 年，或自定义起止日期（bucket：none = 一个 Total 列）。 */
export type PeriodSpec =
  | { mode: "week"; year: number; month: number }
  | { mode: "month"; year: number }
  | { mode: "quarter"; year: number }
  | { mode: "year"; year: number; years: number }
  | {
      mode: "custom";
      start: string;
      end: string;
      bucket: "none" | "week" | "month";
    };

function periodQuery(spec: PeriodSpec): Record<string, string | number> {
  switch (spec.mode) {
    case "week":
      return { granularity: "week", year: spec.year, month: spec.month };
    case "month":
    case "quarter":
      return { granularity: spec.mode, year: spec.year };
    case "year":
      return { granularity: "year", year: spec.year, years: spec.years };
    case "custom":
      return {
        start_date: spec.start,
        end_date: spec.end,
        bucket: spec.bucket,
      };
  }
}

/** 一次只返回一个指标；All three 由页面并行请求三次再拼。 */
export function fetchBreakdown(
  spec: PeriodSpec,
  metric: BreakdownMetric,
  signal?: AbortSignal,
): Promise<BreakdownResponse> {
  return apiFetch<BreakdownResponse>("/api/sales-report/amount/products", {
    cache: "no-store",
    signal,
    query: { metric, ...periodQuery(spec) },
  });
}

/** 点开某个产品时再取：这个产品按 agent 拆（没写 agent 的叫 Direct）。 */
export function fetchProductAgents(
  spec: PeriodSpec,
  metric: BreakdownMetric,
  productCode: string,
  signal?: AbortSignal,
): Promise<ProductAgentsResponse> {
  return apiFetch<ProductAgentsResponse>(
    "/api/sales-report/amount/product-agents",
    {
      cache: "no-store",
      signal,
      query: { metric, product_code: productCode, ...periodQuery(spec) },
    },
  );
}
