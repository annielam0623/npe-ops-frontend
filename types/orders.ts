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
