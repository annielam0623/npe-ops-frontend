import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import {
  ApiError,
  type OrderDetail,
  type OrderListPage,
  type OrderListQuery,
  type OrderPatch,
  type OrderRefreshResult,
} from "@/types";

/**
 * 订单。全部 require_staff。列表 / 导出只读；详情页可以改确认号、午餐数、价格（写生产库 + activity_log）。
 * ⚠️ 不要改真实 Rezdy 订单：确认号是景点前台核对用的，午餐数会显示在客人页。测试用 CHDTESTORDER 开头的单。
 */
const API = "/api/operations/orders";

function listQuery(q: OrderListQuery) {
  const hasDate = !!(q.dateFrom || q.dateTo);
  return {
    q: q.q.trim() || undefined,
    date_field: hasDate ? "tour" : undefined,
    date_from: q.dateFrom || undefined,
    date_to: q.dateTo || undefined,
  };
}

/** pageSize：Orders 页 50；顶栏订单搜索取 200（后端上限）。 */
export function fetchOrders(
  q: OrderListQuery,
  signal?: AbortSignal,
  pageSize = 50,
): Promise<OrderListPage> {
  return apiFetch<OrderListPage>(API, {
    cache: "no-store",
    signal,
    query: { ...listQuery(q), page: q.page, page_size: pageSize },
  });
}

/**
 * 导出 Excel（后端生成，列固定）：按当前筛选的全部行。用 fetch 下载，失败能显示原因。
 * 返回文件名和内容。
 */
export async function downloadOrdersExport(
  q: OrderListQuery,
): Promise<{ blob: Blob; filename: string }> {
  const qs = buildQueryString(listQuery(q));
  const res = await fetch(`${API}/export${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename =
    /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "orders.xlsx";
  return { blob: await res.blob(), filename };
}

export function fetchOrder(
  orderNumber: string,
  signal?: AbortSignal,
): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`${API}/${encodeURIComponent(orderNumber)}`, {
    cache: "no-store",
    signal,
  });
}

/** 改字段。只读的单 409，校验失败 422（detail 是数组）。 */
export function patchOrder(
  orderNumber: string,
  patch: OrderPatch,
): Promise<{ updated: number; fields: string[]; price_overridden: boolean }> {
  return apiFetch(`${API}/${encodeURIComponent(orderNumber)}`, {
    method: "PATCH",
    body: patch,
  });
}

export function unlockOrderPrice(
  orderNumber: string,
): Promise<{ unlocked: boolean; reason?: string }> {
  return apiFetch(`${API}/${encodeURIComponent(orderNumber)}/unlock-price`, {
    method: "POST",
  });
}

/**
 * 「Refresh from Rezdy」（置顶 111）：按 Rezdy 现在的数据重写这张单。只有新 Rezdy 表的单（editable = false）能用，
 * 要 orders.edit。错误 detail 原样显示（404 / 409 / 502 / 503 / 500）。
 */
export function refreshOrderFromRezdy(
  orderNumber: string,
): Promise<OrderRefreshResult> {
  return apiFetch(
    `${API}/${encodeURIComponent(orderNumber)}/refresh-from-rezdy`,
    { method: "POST" },
  );
}

/** 422 的 detail 是数组：取每项的字段名和 msg，拼成一句人话。 */
export function describeOrderError(error: unknown): string | null {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: unknown } | null;
    if (Array.isArray(body?.detail)) {
      return body.detail
        .map((d: { loc?: unknown[]; msg?: string }) => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
          return `${field ? `${String(field)}: ` : ""}${d.msg ?? ""}`;
        })
        .join("; ");
    }
  }
  return null;
}
