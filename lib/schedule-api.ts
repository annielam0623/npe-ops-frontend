import { apiFetch } from "@/lib/api-client";
import type {
  ScheduleEmployee,
  ScheduleEmployeeInput,
  ScheduleEmployeesResponse,
  ScheduleOk,
  SchedulePublishResult,
  ScheduleSettings,
  ScheduleSlot,
  ScheduleSlotAssignInput,
  ScheduleSlotCreateInput,
  ScheduleSlotTimeInput,
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

export async function fetchScheduleEmployees(
  signal?: AbortSignal,
): Promise<ScheduleEmployee[]> {
  const result = await apiFetch<ScheduleEmployeesResponse>(
    "/api/schedule/employees",
    { cache: "no-store", signal },
  );
  return result.employees;
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
 * 这一周第一次打开、之前没存过任何时段时，服务端直接照上一周复制一份当起点（`copied_from` 会非空），
 * 不需要前端另外调「复制上一周」。
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

/** 新加一个时段（supervisor 及以上），一开始没有人。 */
export function createScheduleSlot(
  weekStart: string,
  input: ScheduleSlotCreateInput,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(`/api/schedule/weeks/${weekStart}/slots`, {
    method: "POST",
    body: input,
  });
}

/** 删掉一个时段（带着的人一起消失，supervisor 及以上）。 */
export function deleteScheduleSlot(
  weekStart: string,
  slotId: number,
): Promise<ScheduleOk> {
  return apiFetch<ScheduleOk>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}`,
    { method: "DELETE" },
  );
}

/** 改一个时段的上下班时间，不改派的人（supervisor 及以上）。 */
export function updateScheduleSlotTime(
  weekStart: string,
  slotId: number,
  input: ScheduleSlotTimeInput,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}/time`,
    { method: "PUT", body: input },
  );
}

/**
 * 把人拖进 / 挪出一个时段（supervisor 及以上）；`employee_id: null` 清空。
 * 挪动（从别的时段拖过来）由调用方先后发两次：目标时段 assign 新人，原时段 assign null。
 */
export function assignScheduleSlot(
  weekStart: string,
  slotId: number,
  input: ScheduleSlotAssignInput,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}/assign`,
    { method: "PUT", body: input },
  );
}

/**
 * 发布这一周（supervisor 及以上）。有空档时后端照样拒（400，body 里带 gaps），
 * 不是只靠前端挡——绕过页面直接调也一样被挡（任务包验收第 5 条）。
 * 已发布的周也能再点一次：等同于重新发布 + 重发通知（后端 -84 2026-10-16 定，编辑已发布的周不自动重发）。
 */
export function publishScheduleWeek(
  weekStart: string,
): Promise<SchedulePublishResult> {
  return apiFetch<SchedulePublishResult>(
    `/api/schedule/weeks/${weekStart}/publish`,
    { method: "POST" },
  );
}
