/**
 * GET /api/manifests?date= —— Manifests 列表（后端 `app/services/manifest_list.py`，2026-10-06 上线）。
 * admin only，纯读：某一天的 Rezdy 订单（item 级，不含已取消），按 Settings → Products 分块。
 */

/** 给人看的状态；已取消的后端不返回，实际多是 confirmed / pending / unknown。 */
export type ManifestStatus = "confirmed" | "pending" | "cancelled" | "unknown";

/**
 * 数据来源：`rezdy_bookings`（webhook 镜像，实时）或 `legacy`（8/16 之前冻结的老 `bookings` 行，
 * Rezdy 之后的取消不会反映——A9 / 对账补漏之后这些行会被新表取代、`lane_source` 自然消失）。
 */
export type ManifestLaneSource = "rezdy_bookings" | "legacy";

export interface ManifestSendInfo {
  at: string | null;
  by: string;
}

export interface ManifestMorningSendInfo extends ManifestSendInfo {
  /** 最近那次一个渠道失败、另一个发出去了；否则 null（同早班发送 / 早班 tracking 的口径）。 */
  partial: { failed: "sms" | "email"; other: "delivered" | "sent" } | null;
}

export interface ManifestRow {
  order_number: string;
  product_code: string;
  product_name: string;
  internal_name: string;
  /** 显示用的产品名：internal_name，没有就 product_name，再没有就 product_code。 */
  product_label: string;
  /** 这个产品码在 Settings → Products 里。 */
  in_products: boolean;
  group_id: number | null;
  group_name: string;
  group_sort: number | null;
  /** Settings → Products 的 Category（`manifest_products.booking_type`）。 */
  category: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  pax: number | null;
  pickup_time: string;
  pickup_location: string;
  status: ManifestStatus;
  /** Rezdy 原文状态（新表）或旧枚举（老行），排查用；页面显示用 status。 */
  rezdy_status: string;
  confirmation_no: string;
  special_requirements: string;
  agent_name: string;
  lane_source: ManifestLaneSource;
  sent: {
    tour: ManifestSendInfo | null;
    morning: ManifestMorningSendInfo | null;
    /** 门票线按「订单 + 团期、任一门票类型」判断，查重键对不上门票页，不能当查重用（后端文件头有说明）。 */
    tickets: ManifestSendInfo | null;
  };
}

export interface ManifestGroup {
  group_id: number | null;
  group_name: string;
  /** group_id 为 null 时区分「在 Products 里但还没归组」(true) 和「没进 Products」(false)。 */
  in_products: boolean;
  rows: number;
  orders: number;
  pax: number;
}

export interface ManifestDay {
  date: string;
  groups: ManifestGroup[];
  rows: ManifestRow[];
}
