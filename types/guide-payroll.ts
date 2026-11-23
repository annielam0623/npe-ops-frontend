/**
 * Settings › Human Resource › Payroll（138 / G309，Annie 2026-11-16「138 全部按推荐，动手」，preview V9
 * docs/previews/138-guide-payroll-v9.html）。形状照后端合同 v2（npe-confirmation-service
 * docs/interfaces/guide-payroll-2026-11-13.md，main 85152f75）。钱一律是两位小数的字符串（"230.00"）。
 * 日期一律 YYYY-MM-DD。Extras 的 applies_to / people 等合同 v3（v170），没到时可能没有这两个键。
 */

export type PayrollRole = "guide" | "driver_guide";
export type PayrollRunStatus = "paid" | "no_rate" | "no_guide";

export interface PayrollExtra {
  code: string;
  name: string;
  amount: string;
}

export interface PayrollRun {
  date: string;
  /** 很老的归档日可能是 null：只读。 */
  assignment_id: number | null;
  shift: "bus_tour" | "private_tour";
  manifest_id: number | null;
  tour: string;
  guide_hr_id: number | null;
  guide_name: string | null;
  guide_in_hr: boolean;
  driver_hr_id: number | null;
  driver_name: string | null;
  role: PayrollRole;
  rate_id: number | null;
  /** 价格表的费用；没有价格 = null。 */
  rate_fee: string | null;
  /** 手改的费用；没改 = null。 */
  fee_override: string | null;
  fee: string;
  extras_allowed: PayrollExtra[];
  extras: PayrollExtra[];
  extras_total: string;
  tips: string | null;
  total: string;
  status: PayrollRunStatus;
  day_status: "completed" | "not_completed";
  /** true ⇒ 这天锁住了，整趟只读。 */
  locked: boolean;
  /**
   * G363 车型补贴（后端 08c8f5f8，合同 docs/interfaces/guide-pay-vehicle-extra-2026-11-22.md）。旧后端没有这几个键。
   * van = 那天记下的车号；vehicle_model = 那天的车型（"" = 没有）；guide_position = 导游在 HR 的 Position（手打的 ""）。
   */
  van?: string;
  vehicle_model?: string;
  guide_position?: "" | "driver" | "guide" | "both";
  /** 这趟的车型补贴；没有 = null。mode add = 加在 Driver + Guide 价上，total = 这趟一共给多少（rate_amount）。 */
  vehicle_extra?: PayrollVehicleExtra | null;
  /** 加进 total 的补贴（没有 = "0.00"）。total = fee + vehicle_extra_amount + extras_total + tips。 */
  vehicle_extra_amount?: string;
  /** true ⇒ 写「This run includes both a personal rate and a vehicle extra」。 */
  personal_and_vehicle?: boolean;
}

export interface PayrollVehicleExtra {
  rate_id: number;
  model: string;
  mode: "add" | "total";
  /** 价目表上的数（add = 加多少；total = 这趟一共多少）。 */
  rate_amount: string;
  /** 实际加进这趟的数。 */
  amount: string;
}

/** G363：Pay rates › Vehicle extras 一行（GET /api/payroll/rates 的 vehicle_rates，只回 active 的）。 */
export interface PayrollVehicleRate {
  id: number;
  model: string;
  manifest_id: number;
  tour: string;
  mode: "add" | "total";
  amount: string;
  from: string;
  to: string | null;
  active: boolean;
}

/** PUT /api/payroll/vehicle-rates：不带 id = 新增；带 id = 改（车型和团不能改，只送 mode / amount / from / to）。 */
export interface PayrollVehicleRateInput {
  id?: number;
  model?: string;
  manifest_id?: number;
  mode: "add" | "total";
  amount: string;
  from: string;
  to: string | null;
}

export interface PayrollLock {
  id: number;
  from: string;
  to: string;
  note: string | null;
  created_by: string | null;
}

export interface PayrollPerson {
  hr_id: number | null;
  in_hr: boolean;
  name: string;
  total: string;
  runs: PayrollRun[];
}

export interface PayrollPeriod {
  from: string;
  to: string;
  /** 算到哪天；整期都在将来 = null。 */
  through: string | null;
  locks: PayrollLock[];
  total: string;
  people: PayrollPerson[];
  unpaid: PayrollRun[];
  runs: PayrollRun[];
}

export interface PayrollPersonRef {
  person_key: string;
  hr_id: number | null;
  name: string;
}

export interface PayrollPrice {
  id: number;
  manifest_id: number | null;
  custom_tour: string | null;
  tour: string;
  from: string;
  /** null = 一直用（默认价）。 */
  to: string | null;
  applies_to: "all" | "people";
  people: PayrollPersonRef[];
  guide_fee: string;
  driver_guide_fee: string;
  ant_relay: boolean;
  active: boolean;
}

export interface PayrollExtraRate {
  id: number;
  code: string;
  name: string;
  from: string;
  to: string | null;
  amount: string;
  active: boolean;
  /** 合同 v3（v170），同价格。旧后端没带这两个键 = 对所有人（读的地方按 ?? "all" 处理）。 */
  applies_to?: "all" | "people";
  people?: PayrollPersonRef[];
}

export interface PayrollRates {
  rates: PayrollPrice[];
  extra_rates: PayrollExtraRate[];
  /**
   * 加购项名单（后端 558e1176，2026-11-17 只加不改）：每个 code 一条，含行全删了的（active=false），
   * name = 该 code 最新一行的名字，按 code A→Z。+ Add extra 下拉用它；旧后端没有这个键。
   */
  extras?: { code: string; name: string; active: boolean }[];
  locks: PayrollLock[];
  /**
   * 选人名单（后端 d8a4f4b5，2026-11-17 晚只加不改）：HR 里职位 Guide / Driver + Guide 的所有人，按名字排，
   * 同 Dispatch 导游下拉（nickname 优先）。Applies to 选人用，回传 {hr_id}；手打导游不在里面。旧后端没有这个键。
   */
  guides?: { hr_id: number; name: string }[];
  /** G363：车型补贴（旧后端没有这个键 ⇒ 页面不出 Vehicle extras 一节）。 */
  vehicle_rates?: PayrollVehicleRate[];
  /** G363：Vehicles 车型历史里出现过的车型（排好序），Vehicle extras 表单的 Model 下拉用。 */
  vehicle_models?: string[];
}

/** PUT /api/payroll/rates：不带 id = 新增，带 id = 改（团不能改）。 */
export interface PayrollPriceInput {
  id?: number;
  manifest_id?: number;
  custom_tour?: string;
  from: string;
  to: string | null;
  guide_fee: string;
  driver_guide_fee: string;
  ant_relay: boolean;
  applies_to: "all" | "people";
  people: ({ hr_id: number } | { name: string })[];
}

/** PUT /api/payroll/extra-rates：name = 新加购项；code = 已有加购项的新金额；id = 改一行。 */
export interface PayrollExtraRateInput {
  id?: number;
  code?: string;
  name?: string;
  from: string;
  to: string | null;
  amount: string;
  /** 合同 v3：不带 = all；改一行时要原样再发，不然变回 all。 */
  applies_to?: "all" | "people";
  people?: ({ hr_id: number } | { name: string })[];
}

/** PUT /api/payroll/runs/{assignment_id}：只带要改的键。fee / tips 传 "" = 清掉。 */
export interface PayrollRunInput {
  tips?: string;
  fee?: string;
  extras?: Record<string, boolean>;
}

/** GET /api/payroll/action-log（G203 通用形状）。 */
export interface PayrollLogEntry {
  id: number;
  at: string;
  by: string | null;
  action: string;
  label: string | null;
  what: string | null;
  from: unknown;
  to: unknown;
}

export interface PayrollLogPage {
  entries: PayrollLogEntry[];
  next_cursor: string | null;
}
