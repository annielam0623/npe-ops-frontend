/**
 * Manifests 页（`GET /api/manifests`，后端 `task/manifests-fields` 的接口契约 A–D，提交 04f3fa0）。
 * 标签 / 胶囊 / 字段目录全由后端下发，前端不写死；字段键跨天稳定，账号里存的列选择就存这些键。
 */

export type ManifestTabKey = "bus" | "tickets";

/** 标签和胶囊共用的计数。 */
export interface ManifestCounts {
  rows: number;
  orders: number;
  pax: number;
}

export interface ManifestTab extends ManifestCounts {
  key: ManifestTabKey;
  label: string;
}

/** 胶囊：Bus = Products 的 Group（`g:<id>` / `g:none`）；Tickets = 门票 tour type（`t:<key>` / `t:none`）。 */
export interface ManifestPill extends ManifestCounts {
  key: string;
  label: string;
}

/** 值的显示方式。`money` 是数字，币种在 `currency` 字段；`datetime` 是带时区的 ISO。 */
export type ManifestFieldType =
  "text" | "number" | "money" | "datetime" | "date" | "bool";

export interface ManifestField {
  key: string;
  label: string;
  /** 对应 groups 里的某一组（guest / trip / booking / ours / questions / money…）。 */
  group: string;
  type: ManifestFieldType;
}

export interface ManifestFieldGroup {
  key: string;
  label: string;
}

export type ManifestValue = string | number | boolean | null;

export interface ManifestRow {
  /** `订单号|产品代码|团期`。 */
  row_key: string;
  order_number: string;
  product_code: string;
  tour_date: string;
  /** legacy = 8/16 前的老单，没有 Rezdy 原文快照，问卷 / 大部分 Trip、Booking 字段为空。 */
  lane_source: string;
  /** 只含 `fields` 里的键。 */
  values: Record<string, ManifestValue>;
}

export interface ManifestPage {
  date: string;
  tab: ManifestTabKey;
  is_admin: boolean;
  tabs: ManifestTab[];
  /** 只列当天有行的胶囊，A→Z，none 那颗排最后。当天本标签没有行时为空。 */
  pills: ManifestPill[];
  /** 实际显示的胶囊（以它为准，前端不自己猜）；没有胶囊时为 null。 */
  pill: string | null;
  /** 这个人能勾的全部字段（staff 拿到的没有 money 组）。 */
  catalog: ManifestField[];
  groups: ManifestFieldGroup[];
  default_fields: string[];
  /** 实际返回的列，按这个顺序显示。 */
  fields: string[];
  /** 请求了、但这个人没有权限的键（金额组）。 */
  denied: string[];
  /** 请求了、但今天这个标签没有的键（例如别的日子才出现的问卷题）。 */
  unknown: string[];
  rows: ManifestRow[];
}

/** `PUT /api/manifests/cfm` 的返回：staff 填的确认号（和 Rezdy 自带的 rezdy_cfm 分开）。 */
export interface ManifestCfmResult {
  order_number: string;
  product_code: string;
  tour_date: string;
  confirmation_no: string;
  updated_by: string;
  updated_at: string;
}
