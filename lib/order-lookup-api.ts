import { describeError, isStatus } from "@/lib/api-errors";
import { fetchMorningTracking } from "@/lib/morning-tracking-api";
import { fetchOrder, fetchOrders } from "@/lib/orders-api";
import { fetchTicketsTracking } from "@/lib/tickets-tracking-api";
import { fetchTourTracking } from "@/lib/tour-tracking-api";
import type {
  MorningTrackingRow,
  OrderDetail,
  OrderRow,
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

// ── 按单号 / 客人姓名 / 电话搜（Annie 2026-10-14）──────────────────────────────

const SEARCH_PAGE_SIZE = 200;

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const digitsOf = (s: string) => s.replace(/\D/g, "");
/** 只有数字和电话里常见的符号、至少 4 位数字：当电话号码搜。 */
const isPhoneLike = (q: string) =>
  /^[+\d\s().-]+$/.test(q) && digitsOf(q).length >= 4;

/** 单号、姓名、电话三者之一对得上才算（后端的 q 还会匹配邮箱、产品名，那些不要）。 */
function hit(row: OrderRow, q: string): boolean {
  const qn = normText(q);
  if (normText(row.order_number).includes(qn)) return true;
  if (row.name !== "—" && normText(row.name).includes(qn)) return true;
  return (
    isPhoneLike(q) &&
    row.phone !== "—" &&
    digitsOf(row.phone).includes(digitsOf(q))
  );
}

/**
 * 订单列表接口（/api/operations/orders?q=，Orders 页同一个）按输入搜，留下单号 / 姓名 / 电话对得上的，按单号去重（新表一单多行）。
 * 后端是逐列模糊匹配，所以：
 * - 姓名带空格（名 + 姓）时原样搜不到 ⇒ 用最长的那个词再搜一次，前端按全名过滤；
 * - 电话格式不同（库里「(702) 555-0100」、输入「7025550100」）原样搜不到 ⇒ 用纯数字、再用最后 4 位搜，前端按数字过滤。
 * 每次最多取最近的 200 条；more = 还有更多没取回来（叫 staff 输入多一点）。
 */
export async function searchOrders(
  input: string,
  signal?: AbortSignal,
): Promise<{ orders: OrderRow[]; more: boolean }> {
  const q = input.trim();
  const tries: string[] = [q];
  if (isPhoneLike(q)) {
    const d = digitsOf(q);
    if (d !== q) tries.push(d);
    if (d.length > 4) tries.push(d.slice(-4));
  } else if (/\s/.test(q)) {
    const longest = q.split(/\s+/).sort((a, b) => b.length - a.length)[0];
    if (longest) tries.push(longest);
  }
  for (const term of [...new Set(tries)]) {
    const page = await fetchOrders(
      { q: term, dateFrom: "", dateTo: "", page: 1 },
      signal,
      SEARCH_PAGE_SIZE,
    );
    const seen = new Set<string>();
    const orders = page.records.filter((r) => {
      if (!hit(r, q) || seen.has(r.order_number)) return false;
      seen.add(r.order_number);
      return true;
    });
    if (orders.length)
      return { orders, more: page.total > page.records.length };
  }
  return { orders: [], more: false };
}

export function isSameOrder(a: string, b: string): boolean {
  return sameOrder(a, b);
}
