import { apiFetch } from "@/lib/api-client";
import type {
  DashboardWidgets,
  OperationReportCreateResult,
  OperationReportDetail,
  OperationReportInput,
  OperationReportList,
  OperationReportPatch,
  OperationReportQuery,
  OperationReport,
  ReportAssignee,
} from "@/types";

/** 板块 id：后端 dashboard_widgets_visibility 里登记的 key。 */
export const DOR_WIDGET_ID = "daily_operation_report";

/**
 * 板块可见性（所有登录员工可读）。读不到（404 / 403 / 出错）一律当不可见：调用方不要再去请求 DOR 接口——
 * 非 Super Admin 在开关关着时调 DOR 接口会 403。
 */
export function fetchDashboardWidgets(
  signal?: AbortSignal,
): Promise<DashboardWidgets> {
  return apiFetch<DashboardWidgets>("/api/settings/dashboard-widgets", {
    cache: "no-store",
    signal,
  });
}

/** 开关只有 Super Admin 能改（其他人 403）。位置和样子待 Annie 看 preview，这里先备好接口。 */
export function updateDashboardWidgets(
  widgets: Record<string, "staff" | "super_admin_only">,
): Promise<DashboardWidgets> {
  return apiFetch<DashboardWidgets>("/api/settings/dashboard-widgets", {
    method: "PUT",
    body: { widgets },
  });
}

/** 不带 status = 后端默认 open,in_progress（Dashboard 块直接用）。 */
export function fetchOperationReports(
  query: OperationReportQuery = {},
  signal?: AbortSignal,
): Promise<OperationReportList> {
  return apiFetch<OperationReportList>("/api/operation-reports", {
    cache: "no-store",
    signal,
    query: { ...query },
  });
}

export function fetchOperationReport(
  id: number,
  signal?: AbortSignal,
): Promise<OperationReportDetail> {
  return apiFetch<OperationReportDetail>(`/api/operation-reports/${id}`, {
    cache: "no-store",
    signal,
  });
}

/** 同一个 client_token 再提交返回第一次那条（duplicate: true），不会重复写库。 */
export function createOperationReport(
  input: OperationReportInput,
): Promise<OperationReportCreateResult> {
  return apiFetch<OperationReportCreateResult>("/api/operation-reports", {
    method: "POST",
    body: input,
  });
}

/** 只带要改的键；null 的 follow_up_user_id = 取消指派。需要 report.edit（主管及以上），否则 403。 */
export async function updateOperationReport(
  id: number,
  patch: OperationReportPatch,
): Promise<OperationReport> {
  const result = await apiFetch<{ report: OperationReport }>(
    `/api/operation-reports/${id}`,
    { method: "PATCH", body: patch },
  );
  return result.report;
}

export async function fetchReportAssignees(
  signal?: AbortSignal,
): Promise<ReportAssignee[]> {
  const result = await apiFetch<{ users: ReportAssignee[] }>(
    "/api/operation-reports/assignees",
    { cache: "no-store", signal },
  );
  return result.users;
}
