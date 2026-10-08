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
  vehicles: { id: number; van_no: string; has_tracking: boolean }[];
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
