import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type {
  SendBatchDetail,
  SendLogGroupRow,
  SendLogGroupsPage,
  SendLogPage,
  SendLogQuery,
} from "@/types";

/** 每页 100 组，一组不拆到两页（Annie 2026-11-01；后端上限也是 100）。 */
export const SEND_LOG_GROUPS_PAGE_SIZE = 100;
/** 页面下方 ⚠️ Errors 看最近这么多条（逐条接口，同样的筛选）。 */
export const SEND_LOG_ERRORS_PAGE_SIZE = 200;

/** 行的筛选（不含日期）：空字符串的不传。 */
function rowFilters(query: SendLogQuery) {
  const orderNumber = query.orderNumber.trim();
  return {
    // 后端按字面「包含」搜（% _ \ 已转义）。
    order_number: orderNumber || undefined,
    mtlv_eligible: query.mtlv ? true : undefined,
    module: query.module || undefined,
    channel: query.channel || undefined,
    status: query.status || undefined,
  };
}

/** 日期 + 行的筛选。按订单号搜时不限日期（Annie 2026-10-05 定），后端不传日期 = 全部日期。 */
function logFilters(query: SendLogQuery) {
  const searching = !!query.orderNumber.trim();
  return {
    date_from: searching ? undefined : query.from,
    date_to: searching ? undefined : query.to,
    ...rowFilters(query),
  };
}

/** 逐条（staff 及以上可调；纯读）：只用来列页面下方的 ⚠️ Errors。 */
export function fetchSendLog(
  query: SendLogQuery,
  signal?: AbortSignal,
): Promise<SendLogPage> {
  return apiFetch<SendLogPage>("/api/notifications/send-log", {
    cache: "no-store",
    signal,
    query: {
      ...logFilters(query),
      page: 1,
      page_size: SEND_LOG_ERRORS_PAGE_SIZE,
    },
  });
}

/** G230：整页按组，一次发送一组，新的在前。一组里有一条符合筛选就列整组。 */
export function fetchSendLogGroups(
  query: SendLogQuery,
  signal?: AbortSignal,
): Promise<SendLogGroupsPage> {
  return apiFetch<SendLogGroupsPage>("/api/notifications/send-log/groups", {
    cache: "no-store",
    signal,
    query: {
      ...logFilters(query),
      page: query.page,
      page_size: SEND_LOG_GROUPS_PAGE_SIZE,
    },
  });
}

/**
 * 一组的全部行（新的在前），每行带 matched。不传日期：组是按日期列出来的，
 * 半夜跨天的那几条也算这一组；matched 只看订单号 / 模块 / 渠道 / 状态 / MTLV。没有这一组 404。
 */
export async function fetchSendLogGroupRows(
  batchId: number,
  query: SendLogQuery,
  signal?: AbortSignal,
): Promise<SendLogGroupRow[]> {
  const res = await apiFetch<{ rows: SendLogGroupRow[] }>(
    `/api/notifications/send-log/groups/${batchId}/rows`,
    { cache: "no-store", signal, query: rowFilters(query) },
  );
  return res.rows ?? [];
}

/**
 * CSV 导出（旧页面同一个地址）：按洛杉矶日期范围、可选模块过滤，不支持渠道 / 状态 / MTLV。
 * 浏览器直接打开这个同源地址下载，cookie 随请求带上。
 */
export function buildSendLogExportUrl(
  query: Pick<SendLogQuery, "from" | "to" | "module">,
): string {
  const qs = buildQueryString({
    date_from: query.from,
    date_to: query.to,
    module: query.module || undefined,
  });
  return `/api/send-log/export?${qs}`;
}

/** 发送页「View this send」：Send Log 里这一组展开（新标签页打开）。 */
export function sendBatchHref(batchId: number): string {
  return `/send-log?batch=${encodeURIComponent(String(batchId))}`;
}

/** 一组的小结（文件几行、送达情况）+ 跳过的单。没有这一组 404。 */
export function fetchSendBatch(
  id: number,
  signal?: AbortSignal,
): Promise<SendBatchDetail> {
  return apiFetch<SendBatchDetail>(`/api/send-batches/${id}`, {
    cache: "no-store",
    signal,
  });
}

/** G129：带着问题、而且真的发出去了的发送（staff 勾了 Send anyway）。只含订单号和原因，不含客人姓名 / 电话 / 邮箱。 */
export interface SendOverride {
  id: number;
  /** `morning_relay:<轮次>`（relay / relay_2 / tour_car）、`farm_out_notice`、`tickets_reminder`。 */
  module: string;
  run_date: string | null;
  orders: string[];
  reasons: Record<string, string[]>;
  actor: string;
  actor_name: string | null;
  created_at: string;
}

/** 「Sent with an override」：按发送发生的洛杉矶日期（含两端），新的在前，最多 200 条。 */
export async function fetchSendOverrides(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<SendOverride[]> {
  const res = await apiFetch<{ overrides: SendOverride[] }>(
    "/api/send-log/overrides",
    {
      cache: "no-store",
      signal,
      query: { date_from: from, date_to: to },
    },
  );
  return res.overrides ?? [];
}
