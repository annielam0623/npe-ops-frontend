// Daily Operation Report（DOR）。形状来自后端设计稿 §3（task/dor-backend-design，2026-10-24）：
// 后端是权威，7d 会发最终样例，字段名以最终样例为准。

export type ReportType = "complaint" | "accident" | "emergency" | "no_show";
/** office = Office / Booking（G361 Q4）。 */
export type ComplaintAbout = "driver" | "guide" | "itinerary" | "office";
/** waiting_reschedule：只有 No show、选了 Accepted + 新单号后后端设（G361）。 */
export type ReportStatus =
  "open" | "in_progress" | "waiting_reschedule" | "resolved";
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

/** No show（G361）的 details：staff 能填的键 + 后端写的只读键（后端契约 no-show-2026-11-26.md §2）。 */
export type NoShowReportedBy = "driver" | "guide" | "office";
export type NoShowReason =
  "guest_did_not_show" | "wrong_pickup_info" | "not_notified" | "other";
export type NoShowDecision = "accepted" | "declined" | "no_reply";
export type ContactMethod =
  "phone" | "text" | "whatsapp" | "email" | "in_person";

export interface NoShowClientDetails {
  /** YYYY-MM-DD，必填。 */
  tour_date: string;
  product_code: string;
  product_name: string;
  pickup_location: string;
  driver_name: string;
  guide_name: string;
  vehicle: string;
  reported_by: NoShowReportedBy;
  reason: NoShowReason;
  decision: NoShowDecision;
  new_order_number: string;
  /** YYYY-MM-DD。 */
  follow_up_due: string;
}

export interface NoShowServerDetails {
  source: "manual" | "tracking";
  farm_out: boolean;
  follow_up_task_id: number;
  follow_up_task_for: string;
  tracking_cleared_at: string;
  ready_to_close_at: string;
}

/** 后端 SERVER_FIELDS：只读，送上去 ⇒ 400。 */
export const NO_SHOW_SERVER_KEYS: readonly (keyof NoShowServerDetails)[] = [
  "source",
  "farm_out",
  "follow_up_task_id",
  "follow_up_task_for",
  "tracking_cleared_at",
  "ready_to_close_at",
];

export type ReportDetails = Partial<AccidentDetails> &
  Partial<NoShowClientDetails> &
  Partial<NoShowServerDetails>;

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
  details: ReportDetails;
}

/** No show 联系记录（只加，旧的在上）。 */
export interface NoShowContact {
  id: number;
  report_id: number;
  method: ContactMethod;
  method_label: string;
  contacted_at: string;
  reached: boolean;
  guest_said: string | null;
  created_at: string;
  created_by: ReportPerson;
}

export interface NoShowContactInput {
  method: ContactMethod;
  /** 带偏移的 ISO，不能是将来。 */
  contacted_at: string;
  reached: boolean;
  guest_said?: string;
}

/** 改期的新单：Order List 里的状态 + 有没有上车。 */
export interface NoShowRescheduled {
  order_number: string;
  found: boolean;
  tour_date: string | null;
  status: string;
  live: boolean;
  boarded: boolean;
}

/** 订单详情 operation_reports[] 和 order-context 的 reports[] 每一项。 */
export interface OrderReport extends OperationReport {
  updates: OperationReportUpdate[];
  /** 这单是另一份 No show 的改期新单。 */
  rescheduled_into_this_order: boolean;
}

export interface NoShowPrefillDay {
  tour_date: string;
  product_code: string;
  product_name: string;
  guest_name: string;
  pickup_location: string;
  driver_name: string;
  guide_name: string;
  vehicle: string;
  farm_out: boolean;
  on_main_manifest: boolean;
}

export interface NoShowPrefill {
  order_number: string;
  found: boolean;
  days: NoShowPrefillDay[];
}

export interface OrderContextMark {
  tour_date: string;
  col: string;
  source: string;
  by: string;
  at: string;
}

export interface OrderContext {
  order_number: string;
  reports: OrderReport[];
  /** 没有 orders.view ⇒ 不带。 */
  staff_notes?: import("@/lib/staff-notes-api").StaffNote[];
  no_show_marks?: OrderContextMark[];
}

export interface OperationReportCounts {
  complaint: number;
  accident: number;
  emergency: number;
  /** G361 后端加；旧后端没有。 */
  no_show?: number;
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
  /** add_update：加了一条 Updates（G224），changes 为空，前端不显示。 */
  action: "create" | "update" | "add_update";
  changes: OperationReportHistoryChange[];
}

/** 报告下面的一条 Updates（G224）：只能加，不能改、删。 */
export interface OperationReportUpdate {
  id: number;
  report_id: number;
  text: string;
  /** 带偏移的 ISO 时间（洛杉矶）。 */
  created_at: string;
  created_by: ReportPerson;
}

export interface OperationReportDetail {
  report: OperationReport;
  history: OperationReportHistoryEntry[];
  /** 从旧到新。后端 G224 上线前没有这个字段。 */
  updates?: OperationReportUpdate[];
  /** 只有 No show 有（G361）。 */
  contacts?: NoShowContact[];
  rescheduled?: NoShowRescheduled | null;
  ready_to_close?: boolean;
}

export interface OperationReportInput {
  report_type: ReportType;
  complaint_about: ComplaintAbout | null;
  order_number: string | null;
  subject_name: string | null;
  what_happened: string;
  details: ReportDetails;
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
  /**
   * 置顶 109 W4 第二段（后端 f30d895a，send-outcome 文档第 5 节）：按人算——有账号的人站内或邮件任一发出 = sent（列名字），
   * 部门邮箱 / reservations@ 按地址列；都没发出 = failed（error 英文原话）。no_contact 永远 []（都有账号）。
   * 开关关 / 没收件人（有 skipped）时三份都空。没带 = 旧后端。
   */
  sent?: string[];
  failed?: { name: string; error: string }[];
  no_contact?: { name: string; why: string }[];
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
  /** No show：整份替换 staff 能填的那部分（系统键后端保留）。 */
  details?: Partial<NoShowClientDetails>;
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
  /**
   * 这一项能不能「另外按人放开」（后端 33，2026-11-08：目前只有 schedule_period）。没带 = 后端还旧。
   */
  allow_list?: boolean;
  /** 另外放开的人：Super Admin 拿到 {id, name, role}，其他人只拿到 id。 */
  allowed_users?: (AllowedUser | number)[];
}

/** Page visibility「Also allowed」名单上的一个人（admin_users）。 */
export interface AllowedUser {
  id: number;
  name: string;
  role: string;
}

export interface DashboardWidgets {
  readable: boolean;
  widgets: DashboardWidget[];
}
