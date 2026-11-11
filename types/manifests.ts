import type { OutcomeFields } from "@/lib/send-outcome";
/**
 * Manifests 页（`GET /api/manifests`，后端 `task/manifests-fields` 的接口契约 A–D，提交 04f3fa0）。
 * 标签 / 胶囊 / 字段目录全由后端下发，前端不写死；字段键跨天稳定，账号里存的列选择就存这些键。
 */

export type ManifestTabKey = "bus" | "tickets" | "admin_fee";

/** 标签和胶囊共用的计数。 */
export interface ManifestCounts {
  rows: number;
  orders: number;
  pax: number;
  /**
   * pax 是 null 的行数（只有 admin_fee 标签和它的胶囊带，后端 G232）：pax 只加非 null 的行。
   * 费用件数 = 人数（Annie 2026-11-02）；8/16 前的老单可能拿不到件数。旧后端 / Bus / Tickets 没有 ⇒ 当 0。
   */
  pax_unknown?: number;
}

export interface ManifestTab extends ManifestCounts {
  key: ManifestTabKey;
  label: string;
  /** 这个标签能不能发（admin_fee = CHD 组的 Admin fee 是 false；后端 G232）。旧后端没有 ⇒ 当 true。 */
  sendable?: boolean;
}

/** 胶囊：Bus = Products 的 Group（`g:<id>` / `g:none`）；Tickets = 门票 tour type（`t:<key>` / `t:none`）。 */
export interface ManifestPill extends ManifestCounts {
  key: string;
  label: string;
  /**
   * Settings → Products → Manifest setup 配的团颜色（G142，后端 2026-10-20 `e5bdec9`）；
   * `#rrggbb` 或 null（没配颜色、或这颗胶囊不是团——tickets / "No group yet" 恒 null）。
   * 旧后端没有这个字段时不会出现在 JSON 里，等同 null。
   */
  color?: string | null;
  /** 这颗胶囊能不能发（CHD 组 = Admin fee，false；后端 G232）。旧后端没有 ⇒ 当 true。 */
  sendable?: boolean;
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
  /**
   * 这一行是 shuttle（产品的 booking_type，没有再看组的，= 'shuttle'；后端 G189）。
   * 发 Send tour confirmation 时后端自动用这个产品的 Content Studio Shuttle 模板。旧后端没有 ⇒ 当团行。
   */
  shuttle?: boolean;
  /**
   * 这一行能不能勾、能不能发（后端 G232）。CHD 组的行（改期费 / 手续费，不是真客人）是 false：
   * Annie 2026-11-02「不发送，它是一个Admin fee，不参与排团，但是要追踪是否购买和收款」。
   * 后端发送时逐行复核，一批里夹一条就整批失败，所以前端不让勾。旧后端没有这个字段 ⇒ 当 true。
   */
  sendable?: boolean;
  /**
   * 置顶 74（后端 brenda-waiver-link，v147）：true = 这张门票要每单一条 waiver link（Upper Antelope Brenda 两种），
   * 这一行的 Waiver link 格可以填；没填 = 发送时像 No Cfm # 一样被挡（可 Send anyway）。旧后端没有 ⇒ 当 false。
   */
  waiver_link_required?: boolean;
  /**
   * G245（置顶 82，Annie「羚羊谷，请动手」）：Rezdy 带来的 Cfm # 不是这个产品的——Rezdy 在另一个羚羊谷确认号栏里有号
   * （例 {other_label: "Antelope Canyon X Confirmation #", other_value: "387826855"}）；没问题 / staff 已在 Cfm # 格填了 = null。
   * 有值时不能发（手动、自动都挡，不能 Send anyway）。旧后端没有这个键。
   */
  cfm_mismatch?: { other_label: string; other_value: string } | null;
  /**
   * 门票 Cfm # 规则（后端 51ffe2ca，Annie 2026-11-06「全按推荐，动手」）：这个门票团不需要 Cfm #
   * （tix_tour_types.skip_confirmation_no，Hogan 两个团）⇒ 没号 / 号短都不挡。旧后端没有 ⇒ 当 false。
   */
  cfm_not_needed?: boolean;
  /** 有号、但整串里的数字不到 6 个（「1」「TBA」）⇒ 发送当没号挡（可 Send anyway 照发原值）。只看门票。 */
  cfm_short?: boolean;
  reason?: string | null;
  /** 不能发的原因，例如 "Admin fee - not sent, not dispatched"。 */
  reason_label?: string | null;
  /**
   * 这一行为什么出在这一天（后端 G232）："order_date" = 没有团日期的 admin fee 产品（PLU3N8 / PXLTL1），
   * 放在订单的 LA 下单日（Annie 2026-11-02 定），行上写 reason_label。普通行 null。
   */
  shown_on?: string | null;
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
  /**
   * G198（后端 8a）：只有 tour 节带。开了格（Manifest setup 勾了 Cfm #）时标题行出 Cfm # 格；
   * 开了格的节就算当天只有这一节也会给 sections。没有这个键 = 后端没上线，标题行照旧。
   */
  show_cfm?: boolean;
  /** 开了格时是号或 ""；没开格是 null。 */
  cfm_no?: string | null;
  cfm_updated_by?: string | null;
  cfm_updated_at?: string | null;
  /** Max allotments 的 Time 原文，例 "12:40P"；没设是 ""。 */
  tour_time?: string;
  checkin_time?: string;
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
  /** 只有请求带 include_hidden=true 才有（后端 G167）；人数不含在 tabs / pills 里。 */
  hidden?: ManifestHidden;
}

/**
 * 页面平时不显示的 confirmed 行（后端 G167，`include_hidden=true` 才有）：只能看，不能勾、不能发送。
 * reason 四种；reason_label 是英文短句，直接显示。
 */
export type ManifestHiddenReason =
  | "unmapped_group"
  | "custom_category_group"
  | "product_category"
  | "product_category_in_operational_group";

export interface ManifestHiddenRow {
  row_key: string;
  order_number: string;
  product_code: string;
  tour_date: string;
  lane_source: string;
  leg?: "out" | "return" | null;
  /** 没归组是 "No group yet"。 */
  group_name: string;
  group_type: string | null;
  category_code: string | null;
  reason: ManifestHiddenReason;
  reason_label: string;
  /** 取法和主表一样（按本次 fields 参数 / 默认字段）。 */
  values: Record<string, ManifestValue>;
}

export interface ManifestHidden {
  pill: {
    key: "hidden";
    label: string;
    color: null;
    sendable: false;
    rows: number;
    orders: number;
    pax: number;
  };
  rows: ManifestHiddenRow[];
}

/** 群发查重（G62）：这一单这个团期已经收过一模一样的消息。 */
export interface BroadcastAlreadySent {
  order_number: string;
  sent_at: string;
  sent_by: string;
}

/** `POST /api/manifests/broadcast/check` 的返回（只读）。 */
export interface ManifestBroadcastCheck {
  checked_at: string;
  already_sent: BroadcastAlreadySent[];
}

/**
 * `POST /api/manifests/broadcast` 的返回：Bus / Tickets 各记一条 Broadcasting Log。
 * 一条线的人全被跳过 ⇒ 那条线不在 results 里。
 */
export interface ManifestBroadcastResult {
  /** 收过一模一样消息、这次跳过的（G62）。 */
  skipped?: BroadcastAlreadySent[];
  checked_at?: string;
  recipient_count: number;
  results: {
    module: "tour" | "tickets";
    broadcast_id: number;
    recipient_count: number;
    sms_sent: number;
    sms_failed: number;
    email_sent: number;
    email_failed: number;
    /** 置顶 109 W3（后端 ceba9aaa）：按客人的四个数 + 逐单结果（每条线一份）。旧后端没有。 */
    sent?: number;
    failed?: number;
    no_contact?: number;
    not_sent?: number;
    results?: ManifestBroadcastOrderResult[];
  }[];
}

/** Manifests 群发逐单结果（置顶 109 W3，同 Tracking 群发）。 */
export interface ManifestBroadcastOrderResult extends OutcomeFields {
  order_number: string;
  sms_status: string | null;
  email_status: string | null;
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
    /** Send Log 批次号（后端 G164，View this send 用）；旧后端没有，当没有批次。 */
    batch_id?: number | null;
    total: number;
    sent: number;
    /** 同团确认发送页：email_status / sms_status 是 "sent…" / "failed: …" / "skipped - …"。 */
    results: ({
      order: string;
      name: string;
      email_status: string;
      sms_status: string;
    } & OutcomeFields)[];
    skipped?: ManifestSendSkipped[];
    /** G189：这一组里被拦、没发的单（shuttle 模板没填齐、没选 tour type、Last Minute 下的 shuttle 等）；其余照发。 */
    blocked?: {
      order_number: string;
      reasons: string[];
      can_override: boolean;
    }[];
  }[];
}

/** `POST /api/manifests/send-tickets`：同门票发送页 `send-bulk` 的结果，多一个 checked_at。 */
export interface ManifestSendTicketsResult {
  checked_at: string;
  sent: number;
  /** Send Log 批次号（后端 G164）；全被 Cfm # 拦住时是 null，旧后端没有，都当没有批次。 */
  batch_id?: number | null;
  results: ({
    chd_number: string;
    name: string;
    sms_ok: boolean;
    email_ok: unknown;
  } & OutcomeFields)[];
  skipped?: ManifestSendSkipped[];
  /** G129：缺 Cfm # 没发的单（其余照发）；`can_override` 为 true 才能 Send anyway。 */
  blocked?: {
    order_number: string;
    reasons: string[];
    can_override: boolean;
  }[];
  /** G129：缺 Cfm # 照发（确认号栏留空）、且真的发出去了的订单号。 */
  overridden_orders?: string[];
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
