import { apiFetch } from "@/lib/api-client";
import { isStatus } from "@/lib/api-errors";

/**
 * Tour / Tickets Tracking「搜索不限日期」（Annie 2026-11-23「Tracking搜索全部同意推荐，动手」，
 * preview https://claude.ai/artifact/TZYW2kAVLFsdqkkkRQBaVZ ，Q1–Q6 A、Q7 B）。
 * 后端合同 docs/interfaces/tracking-find-order-2026-11-23.md（后端窗口 47，main 3bfd9440）：两个只读接口，
 * 能读任一 Tracking 页（tour.view 或 tickets.view）就能用，不要 orders.view；都没有 ⇒ 403。数据从 Order List 读（订单流规则，不碰 Rezdy）。
 * 400 / 403 / 404 的 detail 是英文原话，原样显示。
 */

/** 这单这一天在哪个 Tracking 页（对这个人）；null = 都不在（Admin fee、不在 Main manifest、还没有 Tracking 行……）。 */
export type TrackingPage = "tour" | "tickets";

export interface FoundProduct {
  product_code: string;
  product_name: string;
  /** bus_tour / ticket / unmapped …（同 Order List）。 */
  product_type: string;
  /** YYYY-MM-DD；没有为 null。 */
  tour_date: string | null;
  /** Order List 的 Status 原文（confirmed / pending / cancelled / Rezdy 的字）。 */
  status: string;
  page: TrackingPage | null;
}

export interface FoundOrder {
  order_number: string;
  /** 一个 Order List 项一行，日期早的在前。 */
  products: FoundProduct[];
}

/** 按完整单号找（不分大小写、去头尾空格；部分单号不算）。404 ⇒ null；其余错误抛出。 */
export async function findOrderAnyDate(
  order: string,
  signal?: AbortSignal,
): Promise<FoundOrder | null> {
  try {
    return await apiFetch<FoundOrder>(
      "/api/notifications/tracking/find-order",
      { cache: "no-store", signal, query: { order: order.trim() } },
    );
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

/** Search all dates（Q2 A）里的一行：一单的一个产品。 */
export interface FoundMatch extends FoundProduct {
  order_number: string;
  /** 客人名。 */
  name: string;
}

/**
 * 名字 / 电话搜所有日子（Q2 A「Search all dates →」）。只有数字和 + ( ) - . 空格 ⇒ 电话（至少 4 位），其余 ⇒ 名字（至少 2 个字母）。
 * 最多 20 行，离今天近的在前；truncated = 还有更多。
 */
export async function searchOrdersAnyDate(
  q: string,
  signal?: AbortSignal,
): Promise<{ matches: FoundMatch[]; truncated: boolean }> {
  const r = await apiFetch<{ matches?: FoundMatch[]; truncated?: boolean }>(
    "/api/notifications/tracking/search-all-dates",
    { cache: "no-store", signal, query: { q: q.trim() } },
  );
  return { matches: r.matches ?? [], truncated: !!r.truncated };
}
