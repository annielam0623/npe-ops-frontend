import type { FarmOutView } from "./farm-out";

/** GET /api/operations/orders 的一行。缺的值是字符串 "—"（不是 null），日期是显示用的文字。 */
export interface OrderRow {
  order_number: string;
  lane: string;
  name: string;
  email: string;
  phone: string;
  product_name: string;
  /** bus_tour / ticket / 其他 / "—"。 */
  product_type: string;
  /** "MM/DD/YYYY" 或 "—"。 */
  tour_date: string;
  pickup_time: string;
  pickup_location: string;
  quantities: string;
  agent_name: string;
  source: string;
  created_at: string;
  updated_at: string;
  /** confirmed / pending / cancelled / Rezdy 原值 / "—"。 */
  status: string;
  /**
   * 置顶 75（Annie「同意全部推荐。动手」，定 B）：Agent reference（Rezdy resellerReference）。只有 orders.money_view 的人后端才给、
   * 才按它搜；旧后端没有。
   */
  reseller_reference?: string;
  /** 这一行是靠 agent reference 对上的（后端标；没权限的人永远不会是 true）。 */
  matched_agent_ref?: boolean;
}

export interface OrderListPage {
  total: number;
  page: number;
  pages: number;
  records: OrderRow[];
}

export interface OrderListQuery {
  q: string;
  /** 按团期筛（洛杉矶日期）；空 = 不限。 */
  dateFrom: string;
  dateTo: string;
  page: number;
}

export interface OrderDetail {
  order_number: string;
  status: string;
  /**
   * 置顶 51 B（后端待做，形状照 fa preview 拟）：这单在 Main manifest 上的位置，一单的行可能分在几个标签 / 胶囊上；
   * 不在 Main manifest 上 = []；旧后端没有这个字段 ⇒ 订单卡片不出「Main manifest:」那一行。
   */
  manifest_links?: {
    date: string;
    tab: string;
    tab_label?: string;
    pill: string | null;
    pill_label?: string;
    row_keys: string[];
  }[];
  source: string;
  booking_type: string;
  /** false：订单在新的 Rezdy 表里，暂时只读。 */
  editable: boolean;
  guest: {
    name: string;
    email: string;
    phone: string;
    pax: string | number | null;
  };
  product: {
    code: string;
    name: string;
    type: string;
    tour_date: string;
    tour_time: string;
    pickup_time: string;
    pickup_location: string;
    item_count: number;
  };
  ops: {
    driver: string;
    vehicle_no: string;
    driver_phone: string;
    agent_name: string;
    confirmation_no: string;
    tt_number: string;
    lunch_turkey: number;
    lunch_veggie: number;
    lunch_beef: number;
  };
  price: {
    total_amount: number | null;
    currency: string;
    total_paid: number | null;
    total_due: number | null;
    overridden: boolean;
  };
  /** Rezdy 原始数据（只读展示）。 */
  items_detail: unknown;
  order_detail: unknown;
  special_requirements: string;
  notes: string;
  created_at: string;
  updated_at: string;
  activity_log: {
    id: number;
    event_type: string;
    detail: string;
    actor: string;
    actor_type: string;
    created_at: string;
  }[];
  booking_notes: {
    id: number;
    author: string;
    direction: string;
    body: string;
    sms_status: string;
    email_status: string;
    created_at: string;
  }[];
  /** 转给合作公司的订单才有：两套上车资料 + 谁放前面（后端算）。 */
  farm_out_view?: FarmOutView;
}

/** PATCH 的字段：只传要改的；null = 清空。 */
export interface OrderPatch {
  confirmation_no?: string | null;
  lunch_turkey?: number;
  lunch_veggie?: number;
  lunch_beef?: number;
  total_amount?: number | null;
  total_paid?: number | null;
  total_due?: number | null;
  currency?: string | null;
}

/**
 * Order 详情页「Refresh from Rezdy」（置顶 111，后端 3e task/order-refresh-rezdy）：
 * POST /api/operations/orders/{单号}/refresh-from-rezdy（无请求体，orders.edit）。
 */
export interface OrderRefreshResult {
  order_number: string;
  /** updated = 照 Rezdy 写了（可能什么都没变）；not_applied = Rezdy 回的单没有细节，什么都没改。 */
  result: "updated" | "not_applied";
  rezdy_status: string | null;
  /** 原样显示（可能接着 kept 那句）。 */
  message: string;
  /** 改了的每一项；before / after null = 空。field 例：Phone、Pickup time (P0ABCD)、Item P0ABCD。 */
  changed: { field: string; before: string | null; after: string | null }[];
  /** Rezdy 那项是空的、Order List 保留原值的字段（例 ["Phone"]）。 */
  kept: string[];
}
