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
 * 改一个锁的日期 / 备注（Annie 2026-11-17 样稿第 2 版动手；小题 1 A：直接存）。规则同加锁：不能跟别的锁重叠。
 * ⚠️ 地址 / body 先按前端 mock 拟的（PUT /api/payroll/locks/{id} {from, to, note}），后端 91 合同到了按合同改。
 */
export function editPayrollLock(
  id: number,
  body: { from: string; to: string; note: string | null },
): Promise<{ lock: PayrollLock }> {
  return apiFetch(`/api/payroll/locks/${id}`, { method: "PUT", body });
}
