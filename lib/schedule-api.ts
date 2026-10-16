import { apiFetch } from "@/lib/api-client";
import type {
  ScheduleCellInput,
  ScheduleEmployee,
  ScheduleEmployeeInput,
  SchedulePublishResult,
  ScheduleSettings,
  ScheduleWeek,
  ScheduleWorkWindowInput,
} from "@/types";

/** 工作时段 + 班次类型；所有登录用户都能读，写只有 superadmin（后端挡，前端按 403 隐藏改的入口）。 */
export function fetchScheduleSettings(
  signal?: AbortSignal,
): Promise<ScheduleSettings> {
  return apiFetch<ScheduleSettings>("/api/settings/schedule", {
    cache: "no-store",
    signal,
  });
}

export function updateWorkWindow(
  input: ScheduleWorkWindowInput,
): Promise<ScheduleSettings> {
  return apiFetch<ScheduleSettings>("/api/settings/schedule/work-window", {
    method: "PUT",
    body: input,
  });
}

export function fetchScheduleEmployees(
  signal?: AbortSignal,
): Promise<ScheduleEmployee[]> {
  return apiFetch<ScheduleEmployee[]>("/api/schedule/employees", {
    cache: "no-store",
    signal,
  });
}

/** admin / supervisor 加人；重名不挡（同名同姓现实里会有），后端只按 id 认人。 */
export function addScheduleEmployee(
  input: ScheduleEmployeeInput,
): Promise<ScheduleEmployee> {
  return apiFetch<ScheduleEmployee>("/api/schedule/employees", {
    method: "POST",
    body: input,
  });
}

/**
 * 查一周的排班。staff 查还没发布的周会 403（D5：员工只看已发布的整周）；
 * supervisor 及以上任何时候都能查（草稿也能看自己正在排的）。
 */
export function fetchScheduleWeek(
  weekStart: string,
  signal?: AbortSignal,
): Promise<ScheduleWeek> {
  return apiFetch<ScheduleWeek>(`/api/schedule/weeks/${weekStart}`, {
    cache: "no-store",
    signal,
  });
}

/** 存一个格子（supervisor 及以上）；shift_type 传 null 清空这一格（视为 Off / 没排）。 */
export function saveScheduleCell(
  weekStart: string,
  input: ScheduleCellInput,
): Promise<ScheduleWeek> {
  return apiFetch<ScheduleWeek>(`/api/schedule/weeks/${weekStart}/cells`, {
    method: "PUT",
    body: input,
  });
}

/** 把某一周的格子整份复制过来（supervisor 及以上；目标周已发布时后端拒）。 */
export function copyScheduleWeek(
  weekStart: string,
  sourceWeekStart: string,
): Promise<ScheduleWeek> {
  return apiFetch<ScheduleWeek>(
    `/api/schedule/weeks/${weekStart}/copy-from/${sourceWeekStart}`,
    { method: "POST" },
  );
}

/**
 * 发布这一周（supervisor 及以上）。有空档时后端照样拒（400，body 里带 gaps），
 * 不是只靠前端挡——绕过页面直接调也一样被挡（任务包验收第 5 条）。
 */
export function publishScheduleWeek(
  weekStart: string,
): Promise<SchedulePublishResult> {
  return apiFetch<SchedulePublishResult>(
    `/api/schedule/weeks/${weekStart}/publish`,
    { method: "POST" },
  );
}
