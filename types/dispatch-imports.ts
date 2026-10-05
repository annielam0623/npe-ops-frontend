/** GET /api/dispatch/imports 的一行（CCL 消息里的一台车 / 一行）。 */
export interface DispatchImportLine {
  line_no: number;
  raw_line: string;
  ccl_section: string | null;
  shift: string | null;
  tour_name: string | null;
  bus_label: string | null;
  driver_text: string | null;
  guide_text: string | null;
  vehicle_text: string | null;
  is_driver_guide: boolean;
  route_label: string | null;
  ccl_note: string | null;
  parse_ok: boolean;
  parse_error: string | null;
  /** 按**现在**的 HR / 记忆表重新匹配的名字；没对上为 null；手填的是 "<名字> (typed, not in HR)"。 */
  driver_match: string | null;
  guide_match: string | null;
  /** 分不清是谁时 "Bruce O or Bruce W"，否则 ""。 */
  driver_choices: string;
  guide_choices: string;
  vehicle_match: string | null;
  vehicle_inactive: boolean;
}

export interface DispatchImportClosure {
  line_no: number;
  ccl_section: string | null;
  shift: string | null;
  tour_name: string | null;
  /** null = 显示 Closed。 */
  note: string | null;
}

export interface DispatchImport {
  id: number;
  /** YYYY-MM-DD */
  service_date: string;
  title: string;
  raw_content: string;
  is_revision: boolean;
  status: "pending" | "applied" | "superseded";
  /** 以下时间都是 ISO 带时区，可能为 null。 */
  posted_at: string | null;
  edited_at: string | null;
  version_at: string | null;
  superseded_at: string | null;
  applied_at: string | null;
  imported_at: string | null;
  vehicle_count: number;
  failed_count: number;
  lines: DispatchImportLine[];
  closures: DispatchImportClosure[];
}

export interface DispatchImports {
  /** 实际用的起始日（不传 since 时是服务端默认：洛杉矶今天往前 7 天）。 */
  since: string;
  last_ok: string | null;
  last_failed: string | null;
  /** 没有时 ""。 */
  last_error: string;
  /** 服务日期升序、同一天新版在前；最多最新的 200 版。 */
  imports: DispatchImport[];
}
