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
  vehicles: { id: number; van_no: string; has_tracking: boolean; seats: number | null }[];
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
}

export interface DispatchCopyResult {
  ok: true;
  saved: number;
  dropped: number;
  dropped_expired: number;
  dropped_deleted: number;
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
  /** 座位数，没有就按这个团每车几位。 */
  capacity: number;
  pax: number;
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
  buses: SeatingBus[];
  orders: SeatingOrder[];
}

export interface DispatchSeating {
  run_date: string;
  tours: SeatingTour[];
}
