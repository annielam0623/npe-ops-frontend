import { apiFetch } from "@/lib/api-client";
import type {
  ScheduleEmployee,
  ScheduleEmployeeInput,
  ScheduleEmployeeUpdate,
  ScheduleEmployeesResponse,
  ScheduleOk,
  SchedulePublishResult,
  ScheduleSettings,
  ScheduleShiftType,
  ScheduleSlot,
  ScheduleSlotAssignInput,
  ScheduleSlotCreateInput,
  ScheduleSlotTimeInput,
  ScheduleTimeOff,
  ScheduleTimeOffInput,
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
  /** supervisor 及以上才能要已停用的人（后端对别人会忽略这个参数）。 */
  includeInactive = false,
): Promise<ScheduleEmployee[]> {
  const result = await apiFetch<ScheduleEmployeesResponse>(
    `/api/schedule/employees${includeInactive ? "?include_inactive=1" : ""}`,
    { cache: "no-store", signal },
  );
  return result.employees;
}

/** 改名字 / 邮箱 / 停用（supervisor 及以上）；邮箱改了后端会重新按邮箱对登录账号。 */
export function updateScheduleEmployee(
  id: number,
  input: ScheduleEmployeeUpdate,
): Promise<ScheduleEmployee> {
  return apiFetch<ScheduleEmployee>(`/api/schedule/employees/${id}`, {
    method: "PUT",
    body: input,
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

/** 改 / 清除一个时段的备注（supervisor 及以上）；`null` 或空串 = 清除。后端：≤120 字、不能含换行。 */
export function updateScheduleSlotNote(
  weekStart: string,
  slotId: number,
  note: string | null,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}/note`,
    { method: "PUT", body: { note } },
  );
}

/** 录休假（supervisor 及以上）；一人一天一条，再录同一天 = 更新；和已有班冲突时后端 400 带原话。 */
export function setScheduleTimeOff(
  input: ScheduleTimeOffInput,
): Promise<{ time_off: ScheduleTimeOff[] }> {
  return apiFetch<{ time_off: ScheduleTimeOff[] }>("/api/schedule/time-off", {
    method: "PUT",
    body: input,
  });
}

export function deleteScheduleTimeOff(id: number): Promise<ScheduleOk> {
  return apiFetch<ScheduleOk>(`/api/schedule/time-off/${id}`, {
    method: "DELETE",
  });
}

/**
 * 改班次类型的默认上下班时间（superadmin）。两个都给 = 设置，两个都 null = 清除；
 * 只给一个后端 400 `Send both default_start_time and default_end_time, or neither.`
 */
export function updateShiftTypeDefaults(
  type: ScheduleShiftType,
  input: { default_start_time: string | null; default_end_time: string | null },
): Promise<unknown> {
  // 现有字段原样带上（label / 排序 / 启用），只改默认时间，免得后端把缺的字段当成要清掉。
  return apiFetch<unknown>(
    `/api/settings/schedule/shift-types/${encodeURIComponent(type.key)}`,
    {
      method: "PUT",
      body: {
        label: type.label,
        sort_order: type.sort_order,
        is_active: type.is_active,
        ...input,
      },
    },
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
  opts: { allowGaps?: boolean } = {},
): Promise<SchedulePublishResult> {
  // Publish anyway（Annie 2026-10-29 Q1：admin 及以上）：带 allow_gaps，有空档也发布；权限后端再判一次。
  // 形状照 preview https://claude.ai/artifact/CJaXdFkBS5S4g97gjtxuD8 「需要后端」B1，后端定稿后核对。
  return apiFetch<SchedulePublishResult>(
    `/api/schedule/weeks/${weekStart}/publish`,
    opts.allowGaps
      ? { method: "POST", body: { allow_gaps: true } }
      : { method: "POST" },
  );
}
