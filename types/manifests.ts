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
  /** 所属分节（`"<kind>:<title>"`，后端 2026-10-09 `b84cf37`）；这个胶囊不分节时为 null。 */
  section?: string | null;
  /**
   * 当天来回 shuttle 的两段（后端 G36）："out" 去程、"return" 回程；普通行 null / 没有。
   * 回程那行的 row_key 以 "|return" 结尾（照旧当不透明的键用），排在回程节里，接客时间 / 地点来自产品设置。
   */
  leg?: "out" | "return" | null;
  /** 只含 `fields` 里的键。 */
  values: Record<string, ManifestValue>;
}

/**
 * Bus Tour 胶囊里的一节（Settings → Products → Manifest setup 的 section，同 Bus Manifest 的规则）。
 * 只有一节 / Tickets 标签时 `sections` 是 []，照一张表显示。
 */
export interface ManifestListSection {
  key: string;
  title: string;
  kind: "tour" | "outbound" | "inbound";
  rows: number;
  orders: number;
  pax: number;
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
  /** 非空时 rows 已按节排好。旧后端没有这一项时当作 []。 */
  sections?: ManifestListSection[];
  rows: ManifestRow[];
}

/** `POST /api/manifests/broadcast` 的返回：Bus / Tickets 各记一条 Broadcasting Log。 */
export interface ManifestBroadcastResult {
  recipient_count: number;
  results: {
    module: "tour" | "tickets";
    broadcast_id: number;
    recipient_count: number;
    sms_sent: number;
    sms_failed: number;
    email_sent: number;
    email_failed: number;
  }[];
}

/** 发送页同一个循环跳过的一单（已发过 / 同一批里重复）。 */
export interface ManifestSendSkipped {
  order_number?: string;
  chd_number?: string;
  name: string;
  reason?: string;
  message: string;
}

/** `POST /api/manifests/send-tour`：每组（一个 tour type）一份发送页的结果。 */
export interface ManifestSendTourResult {
  /** 服务器在发之前取的时间；Send anyway 时原样带回（preview_at）。 */
  checked_at: string;
  sent: number;
  groups: {
    tour_type: string;
    total: number;
    sent: number;
    /** 同团确认发送页：email_status / sms_status 是 "sent…" / "failed: …" / "skipped - …"。 */
    results: {
      order: string;
      name: string;
      email_status: string;
      sms_status: string;
    }[];
    skipped?: ManifestSendSkipped[];
  }[];
}

/** `POST /api/manifests/send-tickets`：同门票发送页 `send-bulk` 的结果，多一个 checked_at。 */
export interface ManifestSendTicketsResult {
  checked_at: string;
  sent: number;
  results: {
    chd_number: string;
    name: string;
    sms_ok: boolean;
    email_ok: unknown;
  }[];
  skipped?: ManifestSendSkipped[];
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

/**
 * Cfm # 批量上传用：当天系统里的一行，供按订单号匹配——不需要全部字段，只要定位和核对用到的
 * （`lib/manifests-cfm-import.ts`，没有后端接口，匹配全在前端做）。
 */
export interface ManifestMatchCandidate {
  order_number: string;
  product_code: string;
  tour_date: string;
  pax: number | null;
}
