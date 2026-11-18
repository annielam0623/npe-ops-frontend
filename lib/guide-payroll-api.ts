import { apiFetch } from "@/lib/api-client";
import type {
  PayrollExtraRate,
  PayrollExtraRateInput,
  PayrollLock,
  PayrollLogPage,
  PayrollPeriod,
  PayrollPrice,
  PayrollPriceInput,
  PayrollRates,
  PayrollRunInput,
} from "@/types/guide-payroll";

/**
 * Settings › Human Resource › Payroll（138 / G309）。接口照后端合同 v2（main 85152f75）。
 * 看：Payroll: View（settings.payroll.view）；改：Payroll: Edit（settings.payroll.edit）。没有 ⇒ 403。
 * 400 的 detail 原样标红（describeError）。
 */

/** 一期（1–15 / 16–月底）。date = 这期里任何一天；不带 = 今天（LA）所在的那期。 */
export function fetchPayrollPeriod(
  date: string | null,
  signal?: AbortSignal,
): Promise<PayrollPeriod> {
  return apiFetch<PayrollPeriod>("/api/payroll/period", {
    cache: "no-store",
    signal,
    query: date ? { date } : undefined,
  });
}

/** CSV 下载地址（同源，经 next.config 转给后端）。 */
export function payrollCsvUrl(date: string): string {
  return `/api/payroll/period.csv?date=${encodeURIComponent(date)}`;
}

export function fetchPayrollRates(signal?: AbortSignal): Promise<PayrollRates> {
  return apiFetch<PayrollRates>("/api/payroll/rates", {
    cache: "no-store",
    signal,
  });
}

export function savePayrollPrice(
  body: PayrollPriceInput,
): Promise<{ changed: boolean; rate: PayrollPrice }> {
  return apiFetch("/api/payroll/rates", { method: "PUT", body });
}

export function deletePayrollPrice(
  id: number,
): Promise<{ changed: boolean; rate: PayrollPrice }> {
  return apiFetch(`/api/payroll/rates/${id}`, { method: "DELETE" });
}

export function savePayrollExtraRate(
  body: PayrollExtraRateInput,
): Promise<{ changed: boolean; extra_rate: PayrollExtraRate }> {
  return apiFetch("/api/payroll/extra-rates", { method: "PUT", body });
}

export function deletePayrollExtraRate(
  id: number,
): Promise<{ changed: boolean; extra_rate: PayrollExtraRate }> {
  return apiFetch(`/api/payroll/extra-rates/${id}`, { method: "DELETE" });
}

export function savePayrollRun(
  assignmentId: number,
  body: PayrollRunInput,
): Promise<{ changed: boolean; run: unknown }> {
  return apiFetch(`/api/payroll/runs/${assignmentId}`, {
    method: "PUT",
    body,
  });
}

export function lockPayrollDates(body: {
  from: string;
  to: string;
  note?: string;
}): Promise<{ lock: PayrollLock }> {
  return apiFetch("/api/payroll/locks", { method: "POST", body });
}

export function unlockPayrollDates(
  id: number,
): Promise<{ unlocked: PayrollLock }> {
  return apiFetch(`/api/payroll/locks/${id}`, { method: "DELETE" });
}

/** Change history（G203 通用形状，分页）。 */
export function fetchPayrollLog(
  before: string | null,
  limit: number,
  signal?: AbortSignal,
): Promise<PayrollLogPage> {
  return apiFetch<PayrollLogPage>("/api/payroll/action-log", {
    cache: "no-store",
    signal,
    query: before ? { before, limit: String(limit) } : { limit: String(limit) },
  });
}

/**
 * 改一个锁的日期 / 备注（Annie 2026-11-17 样稿第 2 版动手；小题 1 A：直接存）。规则同加锁：不能跟**别的**锁重叠。
 * 后端合同 guide-payroll-2026-11-13.md（d8a4f4b5）：只带要改的键；回 {changed, lock}；空 body 400、找不到 404。
 */
export function editPayrollLock(
  id: number,
  body: { from: string; to: string; note: string | null },
): Promise<{ changed: boolean; lock: PayrollLock }> {
  return apiFetch(`/api/payroll/locks/${id}`, { method: "PUT", body });
}

/**
 * 自动锁开关（Annie 2026-11-17「问题2是5号发，其他同意推荐，动手」）：开了以后系统每月 20 号 23:59（洛杉矶）锁本月 1–15，
 * 5 号 23:59 锁上个月 16–月底，在 Locked dates 里是一条普通锁（created_by "system"，note "Auto lock"）。默认关。
 * 合同（d8a4f4b5）：GET（view）回 {enabled, enabled_at, can_edit}，can_edit 只有 Super Admin 是 true；
 * PUT 只有 Super Admin（别人 403），回 {enabled, enabled_at, changed, can_edit}。同一个值也在统一开关页（payroll_auto_lock）。
 */
export interface PayrollAutoLockState {
  enabled: boolean;
  enabled_at: string | null;
  can_edit: boolean;
  changed?: boolean;
}

export function fetchPayrollAutoLock(
  signal?: AbortSignal,
): Promise<PayrollAutoLockState> {
  return apiFetch("/api/payroll/auto-lock", { cache: "no-store", signal });
}

export function savePayrollAutoLock(
  enabled: boolean,
): Promise<PayrollAutoLockState> {
  return apiFetch("/api/payroll/auto-lock", {
    method: "PUT",
    body: { enabled },
  });
}
