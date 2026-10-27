// Daily Operation Report（DOR）。形状来自后端设计稿 §3（task/dor-backend-design，2026-10-24）：
// 后端是权威，7d 会发最终样例，字段名以最终样例为准。

export type ReportType = "complaint" | "accident" | "emergency";
export type ComplaintAbout = "driver" | "guide" | "itinerary";
export type ReportStatus = "open" | "in_progress" | "resolved";
export type PoliceReport = "yes" | "no" | "unknown";

export interface ReportPerson {
  id?: number;
  username: string;
  display_name: string;
}

/** Accident 专属字段（details）；其他类型 details 为空对象。 */
export interface AccidentDetails {
  /** 带偏移的 ISO 时间（洛杉矶）。 */
  occurred_at: string;
  location: string;
  vehicle_no: string;
  driver_name: string;
  injuries: string;
  police_report: PoliceReport;
}

export interface OperationReport {
  id: number;
  report_type: ReportType;
  complaint_about: ComplaintAbout | null;
  /** 列表第一行「对谁」，后端算好。 */
  headline: string;
  order_number: string | null;
  subject_name: string | null;
  what_happened: string;
  status: ReportStatus;
  /** null = 还没指定跟进人（当班轮班跟进）。 */
  follow_up: ReportPerson | null;
  created_by: ReportPerson;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  details: Partial<AccidentDetails>;
}

export interface OperationReportCounts {
  complaint: number;
  accident: number;
  emergency: number;
  total: number;
}

export interface OperationReportList {
  items: OperationReport[];
  counts: OperationReportCounts;
  total: number;
  limit: number;
  offset: number;
}

export interface OperationReportQuery {
  /** 逗号分隔；不传 = 后端默认 open,in_progress。 */
  status?: string;
  type?: ReportType;
  /** "none" = 未分配。 */
  follow_up_user_id?: number | "none";
  order_number?: string;
  /** 洛杉矶日期 YYYY-MM-DD，含端点。 */
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface OperationReportHistoryChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

export interface OperationReportHistoryEntry {
  at: string;
  by: string;
  action: "create" | "update";
  changes: OperationReportHistoryChange[];
}

export interface OperationReportDetail {
  report: OperationReport;
  history: OperationReportHistoryEntry[];
}

export interface OperationReportInput {
  report_type: ReportType;
  complaint_about: ComplaintAbout | null;
  order_number: string | null;
  subject_name: string | null;
  what_happened: string;
  details: Partial<AccidentDetails>;
  follow_up_user_id: number | null;
  /** 每次打开弹窗生成一个，防双击重复提交。 */
  client_token: string;
}

export interface OperationReportNotification {
  in_app: number;
  email: number;
  used_fallback: boolean;
  /** "switch_off" = 通知总开关关着，没人被通知；"error" = 通知发送出错（记录已保存）。 */
  skipped?: string;
}

export interface OperationReportCreateResult {
  report: OperationReport;
  /** duplicate:true（同一个 client_token 再提交）时后端给 null。 */
  notification: OperationReportNotification | null;
  duplicate?: boolean;
}

export interface OperationReportPatch {
  status?: ReportStatus;
  follow_up_user_id?: number | null;
}

export interface ReportAssignee {
  id: number;
  username: string;
  display_name: string;
}

/**
 * 板块 / 页面对谁可见（后端 dashboard_widgets，2026-10-25 起三档）：
 * staff = 所有人；admin = admin 和 Super Admin（supervisor、staff 看不到）；super_admin_only = 只有 Super Admin。
 */
export type DashboardWidgetVisibility = "staff" | "admin" | "super_admin_only";

export interface DashboardWidget {
  /** 板块的 key（后端 dashboard_widgets 登记表），如 "daily_operation_report"。 */
  key: string;
  label: string;
  visibility: DashboardWidgetVisibility;
  default: DashboardWidgetVisibility;
  /** 后端算好的「对我可见吗」：前端只信它，不自己拿角色去推。 */
  visible_to_me: boolean;
}

export interface DashboardWidgets {
  readable: boolean;
  widgets: DashboardWidget[];
}
