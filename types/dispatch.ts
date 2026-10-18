import type { FarmOutOrder } from "./farm-out";

/** Dispatch → Assignments（后端 app/routers/dispatch.py）。全部 require_staff。 */

export type DispatchShift = "relay" | "relay_2" | "bus_tour" | "private_tour";

export interface DispatchCcl {
  line_id: number;
  driver_text: string | null;
  guide_text: string | null;
  vehicle_text: string | null;
  is_driver_guide: boolean;
  route_label: string | null;
  ccl_note: string | null;
  driver_candidates: { id: number; name: string }[];
  guide_candidates: { id: number; name: string }[];
}

/** 一台车（一行）。页面上的工作副本也是这个形状。 */
export interface DispatchRow {
  /** 库里原来的编号；新加的车是 null。只随保存送回（服务端靠它保留已删导游的名字）。 */
  id: number | null;
  shift: string;
  driver_hr_id: number | null;
  vehicle_id: number | null;
  manifest_id: number | null;
  guide_hr_id: number | null;
  bus_label: string | null;
  driver_typed_name: string | null;
  guide_typed_name: string | null;
  custom_tour_name: string | null;
  note: string;
  location_ids: number[];
  /** 只显示：人从 HR 删掉后记下的名字。不送回。 */
  driver_name: string | null;
  guide_name: string | null;
  /** 只显示：CCL 预填带来的原文。不送回（只送 ccl_line_id）。 */
  ccl: DispatchCcl | null;
  /**
   * Farm out 车（G40）：整单转给合作公司，不要司机 / 车号 / 导游 / 酒店。后端没上线时没有这几个字段（= 普通车）。
   * partner_name 只显示，不送回。
   */
  farm_out?: boolean;
  partner_id?: number | null;
  partner_name?: string | null;
  /**
   * G82（后端 draft，2026-10-16）：这台 Private 车对的 Rezdy 订单号。后端没上线时没有这两个字段（undefined）：
   * 保存时也不送，免得旧后端不认。有了以后原样送回（漏送 = 订单号静默丢掉）。
   */
  order_number?: string | null;
  /** staff 自己选的订单（Pinned）：自动配对不改它。 */
  order_number_set_by_staff?: boolean;
  /**
   * 这一天这台车临时增减的座位数（后端 `migrate_v104`，Annie 2026-10-17）：0 = 照 Vehicles 里的座位数。
   * 不改 `vehicles.seats`，只影响这一天；保存是整天覆盖，必须原样送回。后端没上线时是 undefined（保存时不送）。
   */
  seat_adjustment?: number;
}

/** 当天已同步的一张 Rezdy Private 订单（G82）。 */
export interface DispatchPrivateOrder {
  order_number: string;
  guest_name: string;
  pax: number;
  /** Rezdy 产品名：配上订单的车，团名用它。 */
  product: string;
  /** 结构化字段，可能不是真实接客安排，要和 notes 一起看。 */
  pickup_time: string | null;
  pickup_location: string | null;
  /** Rezdy 订单备注原文，原样给。 */
  notes: string | null;
  /** 配到这张订单的车（行 id；一张订单可以几台车），空 = 还没配到车。 */
  assigned_assignment_ids: number[];
}

/** POST /api/dispatch/private-match（G82）。 */
export interface DispatchPrivateMatchResult {
  matches: {
    key: string;
    order_number: string | null;
    over_capacity: boolean;
  }[];
  unmatched_orders: string[];
}

export interface DispatchSection {
  shift: string;
  manifest_id: number | null;
  title: string;
  sub: string;
  default_location_ids: number[];
}

export interface DispatchDriver {
  id: number;
  name: string;
  initials: string;
  license_state: "ok" | "soon" | "expired" | "none";
  license_days: number | null;
  /** 在正在排的这一天之前驾照已过期：不进下拉。 */
  license_blocked: boolean;
  position: "driver" | "both";
  /** 空 = 每一段都能跑。 */
  assignments: string[];
}

export interface DispatchDay {
  run_date: string;
  today: string;
  rows: DispatchRow[];
  sections: DispatchSection[];
  orphans: number[];
  drivers: DispatchDriver[];
  /** seats：Settings → Vehicles 填的座位数（2026-10-16 紧急加的字段），没填是 null，不是 0。 */
  vehicles: {
    id: number;
    van_no: string;
    has_tracking: boolean;
    seats: number | null;
  }[];
  locations: { id: number; name: string; active: boolean }[];
  tours: {
    id: number;
    display_name: string;
    is_active: boolean;
    own_section: boolean;
    time_note: string | null;
    default_location_ids: number[];
  }[];
  guides: { id: number; name: string }[];
  copy_from: string | null;
  /** G82：当天已同步的 Rezdy Private 订单，一张一个。后端没上线时没有这个字段，Private 页面照旧。 */
  private_orders?: DispatchPrivateOrder[];
  /** 排车页的 7 个常量（后端 `dispatch.page_meta()`，与旧页面模板同一份；2026-10-04 加）。 */
  meta?: DispatchMeta;
  /** 这一天排班的版本（G71）：占住编辑时原样带回。后端没上线时没有。 */
  version?: string;
  /** 谁正在改这一天（G71）；null = 没人。by_me = 是当前登录的人（别的标签页）。 */
  edit_lock?: DispatchEditLock | null;
  /** 编辑锁的计时（秒，G71）：前端照这几个数计时，不写死。 */
  edit_timing?: DispatchEditTiming;
}

export interface DispatchEditLock {
  by: string;
  /** ISO 时间。 */
  since: string;
  by_me: boolean;
}

export interface DispatchEditTiming {
  /** 最后一次动手后多久弹 Save / Exit 提醒。 */
  remind_after_s: number;
  /** 提醒弹出后多久没人选就自动保存。 */
  auto_save_after_s: number;
  /** 占住期间多久心跳一次。 */
  heartbeat_every_s: number;
}

export interface DispatchMeta {
  coverage_shifts: string[];
  round_names: Record<string, string>;
  relay_shifts: string[];
  bus_tour_shift: string;
  shift_assignment: Record<string, string>;
  assignment_labels: Record<string, string>;
  bus_labels: string[];
}

export interface DispatchSaveResult {
  ok: true;
  saved: number;
  ccl_applied: boolean;
  typed_alert: "sent" | "not_set_up" | "failed" | null;
  typed_names: string[];
  /** Farm out（G40）：这次保存撤销了哪些转单（Farm out 车被删 / 取消 / 换了合作公司）；already_notified = 其中已发过通知的订单号。 */
  farm_out?: { revoked: string[]; already_notified: string[] };
}

export interface DispatchCopyResult {
  ok: true;
  saved: number;
  dropped: number;
  dropped_expired: number;
  dropped_deleted: number;
  /** Farm out 车不抄（G40）：没抄的车数。 */
  dropped_farm_out?: number;
}

export interface DispatchClosure {
  ccl_section: string;
  shift: string | null;
  manifest_id: number | null;
  note: string | null;
}

export type DispatchChange =
  | { kind: "changed"; row_id: number; ccl_row: number; fields: string[] }
  | { kind: "added"; ccl_row: number }
  | { kind: "removed"; row_id: number };

export interface DispatchPrefill {
  import_id: number;
  title: string;
  status: "pending" | "applied" | string;
  is_revision: boolean;
  raw_content: string;
  rows: DispatchRow[];
  unread: { raw_line: string; ccl_section: string; reason: string }[];
  closures: DispatchClosure[];
  changes: DispatchChange[] | null;
}

export interface DispatchPullResult {
  status: "new" | "revision" | "nothing" | "busy" | "failed";
  message: string;
  new?: number;
  revisions?: number;
  last_ok?: string;
}

/**
 * GET /api/dispatch/seating?date=：当天每个巴士团每台车装了哪些订单（G29 第 4 条 Seat guests，后端 `seating_view`）。
 * 客人只来自 Step 1 上传的名单（自动从 Rezdy 进来是后端待办 G35，还没做）。
 * 车 = Step 2 **已保存**的那几台（按 manifest_id + bus_label 对上）。
 */
export interface SeatingBus {
  label: string | null;
  van: string;
  seats: number | null;
  /** 座位数，没有就按这个团每车几位。Farm out 车不限座，后端给 null（G40）。 */
  capacity: number | null;
  pax: number;
  /** Farm out 车（G40）；后端没带时页面按已保存排车的 farm_out 补上。 */
  farm_out?: boolean;
  partner_id?: number | null;
  partner_name?: string | null;
}

/** POST /api/dispatch/seating/move 的返回。farm_out：这次挪动转了 / 撤了哪些订单（订单号），already_notified = 撤销时已发过通知的。 */
export interface SeatingMoveResult {
  ok: boolean;
  moved: number;
  bus_label: string | null;
  run_date?: string;
  manifest_id?: number;
  auto_skipped?: boolean;
  farm_out?: {
    farmed: string[];
    revoked: string[];
    already_notified: string[];
  };
}

export interface SeatingOrder {
  order_number: string | null;
  name: string;
  pax: number;
  guest_ids: number[];
  pickup_time: string | null;
  pickup_location: string | null;
  /** null = 不在今天任何一台车上（装不下）。 */
  bus_label: string | null;
  /** staff 手动挪过（重传 / 改排车时自动分车不动它）。 */
  staff: boolean;
  /** Farm out（G40）：OTA 确认号（没有就是订单号）、成人 / 儿童 / 婴儿数。后端没上线时没有。 */
  ota_conf_number?: string;
  adult?: number;
  child?: number;
  infant?: number;
  /** 客人实付（订单级，G40）。 */
  guest_paid?: number | null;
  /** 只有这单当前坐在 Farm out 车上才非 null。 */
  farm_out?: FarmOutOrder | null;
}

export interface SeatingTour {
  manifest_id: number;
  title: string;
  name: string;
  /** 这个团今天上传过名单。 */
  uploaded: boolean;
  /** none = 没车；single = 一台车（不列订单）；lettered = 多台车、字母不重复（才列订单）；unlettered = 多台车但字母没填好。 */
  mode: "none" | "single" | "lettered" | "unlettered";
  guests_per_bus: number;
  pax: number;
  /** 人数拆开统计（G40，Annie 2026-10-16 晚）：我们车上的 + Farm out 的；pax 仍是总人数。后端没上线时没有。 */
  pax_ours?: number;
  pax_farm_out?: number;
  buses: SeatingBus[];
  orders: SeatingOrder[];
}

export interface DispatchSeating {
  run_date: string;
  tours: SeatingTour[];
}
