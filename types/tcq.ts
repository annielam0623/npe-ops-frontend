/**
 * Transfer & Charter Quotation（后端 G66 阶段二，confirm `01bca8a`，migrate_v93）。接口见 lib/tcq-api.ts，
 * 说明在后端 `docs/previews/my-workspace-2026-10/阶段二_接口说明.md`。钱一律是整数分（21000 = $210）。
 * ⚠️ 服务行、地点、说明、客户名都可能是客人邮件内容：一律当普通文字渲染。
 */

export type TcqServiceKind = "arrival" | "departure" | "charter";
export type TcqRate = "auto" | "normal" | "event";

/** 读取时（或 preview 时）按价目表算的一辆车的价。 */
export interface TcqOption {
  vehicle_id: number;
  vehicle: string;
  seats: number;
  price_cents: number;
  /** 算式，只给 staff 看。 */
  calc: string;
  included_hours: number;
  overtime_cents: number;
  /** Auto 下落在哪个活动里（没有为 null）。 */
  event: string | null;
  rate_used: "normal" | "event";
}

/** 工作项 parsed.services 的一项（读取结果）。 */
export interface TcqParsedService {
  date: string;
  service: TcqServiceKind | null;
  pax: number | null;
  flight: string | null;
  time: string | null;
  /** null = 航空公司表里没有，让 staff 选。 */
  international: boolean | null;
  places: string[];
  hours: number | null;
  /** 原文这一行。 */
  line: string;
  flags: string[];
  rate: TcqRate;
  options: TcqOption[];
  selected: number[];
}

export interface TcqParsed {
  module: "tcq";
  version: 1;
  services: TcqParsedService[];
  unread: string[];
}

/** 报价请求体（preview 和 Generate quote 共用）。 */
export interface TcqRequestService {
  date: string;
  service: TcqServiceKind;
  rate: TcqRate;
  hours: number | null;
  pax: number | null;
  international: boolean | null;
  flight: string;
  time: string;
  places: string[];
  /** 空 = 系统按服务生成英文说明。 */
  description: string;
  /** price_cents null = 按价目表。 */
  vehicles: { vehicle_id: number; price_cents: number | null }[];
}

export interface TcqManualLine {
  /** 挂到某车型块；null = 自己一块（group 是块名）。 */
  vehicle_id: number | null;
  group: string;
  date: string | null;
  description: string;
  qty: number;
  unit_price_cents: number;
  taxable: boolean;
}

export interface TcqRequest {
  client: string;
  services: TcqRequestService[];
  manual_lines: TcqManualLine[];
  /** line = 单列「每天小费」一行；terms = 只写条款。 */
  gratuity: "line" | "terms";
  tax: boolean;
  /** null = 用条款设置里的默认文字；字符串 = 这张单自己的（一行一条）。 */
  inclusions: string | null;
  not_included: string | null;
  assumptions: string | null;
}

export interface TcqQuoteLine {
  kind: "service" | "gratuity" | "manual";
  service?: TcqServiceKind;
  date: string | null;
  description: string;
  qty: string;
  unit_cents: number;
  amount_cents: number;
  taxable: boolean;
  original_cents?: number;
  overridden?: boolean;
  calc?: string;
  rate?: TcqRate;
  rate_used?: "normal" | "event";
  event?: string | null;
  included_hours?: number;
  overtime_cents?: number;
}

export interface TcqQuoteBlock {
  key: string;
  vehicle_id: number | null;
  title: string;
  seats: number | null;
  lines: TcqQuoteLine[];
  subtotal_cents: number;
  taxable_cents: number;
  tax_cents: number;
  total_cents: number;
}

export interface TcqQuoteTerms {
  header: string;
  inclusions: string[];
  not_included: string[];
  assumptions: string[];
  conditions: string[];
  tax_label: string;
}

/** preview 的返回（不存）。 */
export interface TcqQuotePreview {
  client: string;
  blocks: TcqQuoteBlock[];
  /** 各车型块是同一份行程的不同选项 ⇒ 报价单写「Please choose one」。 */
  alternatives: boolean;
  tax_on: boolean;
  tax_pct: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  terms: TcqQuoteTerms;
  flags: string[];
  /** PDF 印不出来的字；非空时 Generate quote 会被拒。 */
  pdf_problems: string[];
}

/** 存下的报价（Generate quote 的返回 / GET /api/tcq/quotes/{id}）。 */
export interface TcqSavedQuote {
  id: number;
  quote_no: string;
  item_id: number;
  item_no: string;
  client: string;
  lines: {
    blocks: TcqQuoteBlock[];
    flags: string[];
    tax_on: boolean;
    alternatives: boolean;
  };
  terms: TcqQuoteTerms;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  created_by_name: string;
  created_at: string;
}

export interface TcqQuoteSummary {
  id: number;
  quote_no: string;
  client: string;
  /** 所有块加起来，只供参考（报价单只印每块自己的合计）。 */
  total_cents: number;
  created_at: string;
  created_by_name: string;
}

/** 价目表的一种车（GET /api/tcq/rate-card、Settings）。 */
export interface TcqVehicle {
  id: number;
  name: string;
  seats: number;
  arrival_intl_cents: number;
  arrival_domestic_cents: number;
  departure_cents: number;
  airport_fee_cents: number;
  /** 半小时为单位。 */
  transfer_hours: number;
  charter_min_hours: number;
  charter_base_cents: number;
  charter_overtime_cents: number;
  event_rate_cents: number;
  event_min_hours: number;
  event_overtime_cents: number;
  gratuity_per_day_cents: number | null;
  is_active: boolean;
  sort_order: number;
}

export type TcqVehicleInput = Omit<TcqVehicle, "id">;

export interface TcqEvent {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  min_days: number | null;
  cancel_days: number;
}

export type TcqEventInput = Omit<TcqEvent, "id">;

export interface TcqTerm {
  key: string;
  kind: "number" | "text";
  label: string;
  value: string;
  sort_order: number;
}

export interface TcqDictionaryTerm {
  id: number;
  kind: string;
  term: string;
}

export interface TcqAirline {
  code: string;
  is_international: boolean;
}

export interface TcqPlace {
  id: number;
  name: string;
  kind: string;
  aliases: string[];
}

export interface TcqSettings {
  vehicles: TcqVehicle[];
  events: TcqEvent[];
  terms: TcqTerm[];
  dictionary: TcqDictionaryTerm[];
  dictionary_kinds: string[];
  airlines: TcqAirline[];
  places: TcqPlace[];
  place_kinds: string[];
}
