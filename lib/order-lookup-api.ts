import { describeError, isStatus } from "@/lib/api-errors";
import { fetchMorningTracking } from "@/lib/morning-tracking-api";
import { fetchOrder } from "@/lib/orders-api";
import { fetchTicketsTracking } from "@/lib/tickets-tracking-api";
import { fetchTourTracking } from "@/lib/tour-tracking-api";
import type {
  MorningTrackingRow,
  OrderDetail,
  TicketsTrackingRow,
  TourTrackingRow,
} from "@/types";

/**
 * dashboard 的订单查询：订单详情 + 这单在三个 Tracking 页上的样子。
 * 后端没有「按单号查 Tracking」的接口，所以先取订单拿团期，再拉那天的三张 Tracking 表、按单号挑出这一单。
 * 全部只读。
 */

/** 一条线的结果：拉到了（这天表里这一单的行，可能 0 行）或拉不到（原因）。一条线失败不影响另外两条。 */
export type LaneResult<Row> =
  { kind: "ok"; rows: Row[] } | { kind: "error"; message: string };

export interface OrderLookup {
  order: OrderDetail;
  /** 去哪天的 Tracking 表里找（YYYY-MM-DD）；订单没有团期时为 null，三条线都不拉。 */
  date: string | null;
  tour: LaneResult<TourTrackingRow> | null;
  tickets: LaneResult<TicketsTrackingRow> | null;
  morning: LaneResult<MorningTrackingRow> | null;
}

/** 订单详情的 tour_date 是 "MM/DD/YYYY"（后端 fmt_date），库里存成字符串的老单可能原样是 "YYYY-MM-DD"；没有为 "—"。 */
export function orderDateToYmd(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

const sameOrder = (a: string, b: string) =>
  a.trim().toUpperCase() === b.trim().toUpperCase();

async function lane<Row extends { order_number: string }>(
  load: () => Promise<{ rows: Row[] }>,
  orderNumber: string,
): Promise<LaneResult<Row>> {
  try {
    const { rows } = await load();
    return {
      kind: "ok",
      rows: rows.filter((r) => sameOrder(r.order_number, orderNumber)),
    };
  } catch (error) {
    // 401 交给调用方跳登录；其余写在这条线自己的格子里。
    if (isStatus(error, 401)) throw error;
    return { kind: "error", message: describeError(error) };
  }
}

/**
 * 按单号查。库里按原样比对，所以先按输入查，查不到（404）且输入里有小写时再按大写查一次（Rezdy / CHD 单号都是大写）。
 * 查不到返回 null；401 等其余错误抛出。
 */
export async function lookupOrder(
  input: string,
  signal?: AbortSignal,
): Promise<OrderLookup | null> {
  const typed = input.trim();
  let order: OrderDetail | null = null;
  for (const candidate of [...new Set([typed, typed.toUpperCase()])]) {
    try {
      order = await fetchOrder(candidate, signal);
      break;
    } catch (error) {
      if (!isStatus(error, 404)) throw error;
    }
  }
  if (!order) return null;

  const date = orderDateToYmd(order.product.tour_date);
  if (!date) return { order, date, tour: null, tickets: null, morning: null };

  const on = order.order_number;
  const [tour, tickets, morning] = await Promise.all([
    lane(() => fetchTourTracking(date, signal), on),
    lane(() => fetchTicketsTracking(date, signal), on),
    lane(() => fetchMorningTracking(date, signal), on),
  ]);
  return { order, date, tour, tickets, morning };
}
