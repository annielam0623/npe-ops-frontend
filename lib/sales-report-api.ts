import { apiFetch } from "@/lib/api-client";

export type ProductType = "bus_tour" | "ticket";
export type Metric = "orders" | "pax";

/** 透视表：每个代理一行，列是月份（1–12）或第几周（1–5）；data 的键是字符串。 */
export interface SalesPivot {
  agents: string[];
  /** 列：月份或周号。 */
  columns: number[];
  /** 列名：Jan… 或 W1…。 */
  columnNames: string[];
  data: Record<string, Record<string, number>>;
  /** 只有周表有，例如 "October 2026"。 */
  subtitle?: string;
}

interface MonthlyResponse {
  agents: string[];
  months: number[];
  month_names: string[];
  data: Record<string, Record<string, number>>;
}

interface WeeklyResponse {
  agents: string[];
  weeks: number[];
  week_names: string[];
  data: Record<string, Record<string, number>>;
  month_name: string;
  year: number;
}

/**
 * 按**团期**算、不含取消的单；没有代理的算 Direct。Orders 数的是预订行（一单多项会算多次）。
 * staff 及以上可调；纯读。
 */
export async function fetchMonthly(
  input: { year: number; productType: ProductType; metric: Metric },
  signal?: AbortSignal,
): Promise<SalesPivot> {
  const r = await apiFetch<MonthlyResponse>("/api/sales-report/monthly", {
    cache: "no-store",
    signal,
    query: {
      year: input.year,
      product_type: input.productType,
      metric: input.metric,
    },
  });
  return {
    agents: r.agents,
    columns: r.months,
    columnNames: r.month_names,
    data: r.data,
  };
}

/** 「周」是按日期切的：W1 = 1–7 号，W2 = 8–14 号…；W5 全是 0 时后端会去掉。 */
export async function fetchWeekly(
  input: {
    year: number;
    month: number;
    productType: ProductType;
    metric: Metric;
  },
  signal?: AbortSignal,
): Promise<SalesPivot> {
  const r = await apiFetch<WeeklyResponse>("/api/sales-report/weekly", {
    cache: "no-store",
    signal,
    query: {
      year: input.year,
      month: input.month,
      product_type: input.productType,
      metric: input.metric,
    },
  });
  return {
    agents: r.agents,
    columns: r.weeks,
    columnNames: r.week_names,
    data: r.data,
    subtitle: `${r.month_name} ${r.year}`,
  };
}
