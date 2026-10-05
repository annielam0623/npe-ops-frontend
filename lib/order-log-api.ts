import { apiFetch } from "@/lib/api-client";
import type { OrderLogPage, OrderLogQuery } from "@/types";

export const ORDER_LOG_PAGE_SIZE = 50;
/** 导出时每次拉的条数（后端上限 200）。 */
const EXPORT_PAGE_SIZE = 200;

/** staff 及以上可调；纯读。不含系统事件和 guest_confirmed（后端固定排除）。 */
export function fetchOrderLog(
  query: OrderLogQuery,
  signal?: AbortSignal,
  pageSize: number = ORDER_LOG_PAGE_SIZE,
): Promise<OrderLogPage> {
  const orderNumber = query.orderNumber.trim();
  return apiFetch<OrderLogPage>("/api/activities/order-log", {
    cache: "no-store",
    signal,
    query: {
      // 按订单号搜时不限日期（Annie 2026-10-05 定），后端两端都不传 = 全部日期。
      date_from: orderNumber ? undefined : query.from || undefined,
      date_to: orderNumber ? undefined : query.to || undefined,
      // 后端按字面「包含」搜（% 和 _ 不是通配符）。
      order_number: orderNumber || undefined,
      event_type: query.eventType || undefined,
      actor_type: query.actorType || undefined,
      page: query.page,
      page_size: pageSize,
    },
  });
}

/** 导出用：按同样的筛选条件把所有页都拉下来（旧页面只导出屏幕上的 50 行）。 */
export async function fetchAllOrderLog(
  query: OrderLogQuery,
): Promise<OrderLogPage["records"]> {
  const all: OrderLogPage["records"] = [];
  for (let page = 1; ; page++) {
    const data = await fetchOrderLog(
      { ...query, page },
      undefined,
      EXPORT_PAGE_SIZE,
    );
    all.push(...data.records);
    if (data.records.length < EXPORT_PAGE_SIZE || all.length >= data.total) {
      return all;
    }
  }
}
