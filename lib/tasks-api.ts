import { apiFetch } from "@/lib/api-client";
import type { DailyTask, TasksToday, TaskTemplate } from "@/types";

/** 任务框（阶段三）。后端 G131（2026-10-22 上线），接口说明 docs/interfaces/tasks-box-phase3-2026-10-21.md。 */
const TODAY = "/api/tasks/today";
const TEMPLATES = "/api/tasks/templates";

/** 今天的任务：员工只看自己的 + 待接受的交接；主管看全部 + 交接通知（is_supervisor_view 由后端按身份判断）。 */
export function fetchTasksToday(signal?: AbortSignal): Promise<TasksToday> {
  return apiFetch<TasksToday>(TODAY, { cache: "no-store", signal });
}

/** 勾 / 取消勾选完成（员工、主管都能勾自己能看到的任务）。 */
export function toggleTaskDone(id: number, done: boolean): Promise<DailyTask> {
  return apiFetch<DailyTask>(`${TODAY}/${id}/done`, {
    method: "PUT",
    body: { done },
  });
}

/** 改截止时间（主管）。传 null 清空截止时间。 */
export function updateTaskDue(
  id: number,
  due_at: string | null,
): Promise<DailyTask> {
  return apiFetch<DailyTask>(`${TODAY}/${id}/due`, {
    method: "PUT",
    body: { due_at },
  });
}

/**
 * Pass over：写交接说明，发给下一班的人；任务仍在我名下，直到对方 Accept。
 * finish_by（ISO，后端 G202 B1，字段名暂定）：交出人设的完成时间；不传就不带这个字段（后端没上线时）。
 */
export function passOverTask(
  id: number,
  note: string,
  finishBy?: string,
): Promise<DailyTask> {
  return apiFetch<DailyTask>(`${TODAY}/${id}/pass-over`, {
    method: "POST",
    body: finishBy ? { note, finish_by: finishBy } : { note },
  });
}

/** 下一班的人 Accept：没有拒绝，接受后任务转到他名下。 */
export function acceptPassOver(id: number): Promise<DailyTask> {
  return apiFetch<DailyTask>(`${TODAY}/${id}/accept`, { method: "POST" });
}

/**
 * 改今天的一条任务（前端 139 = 后端 G269 题 1 B / 题 2 A，Annie 2026-11-14）。部分更新，只传改了的字段。
 * assigned_admin_user_id：null = Everyone on shift；员工不能传（403），只能改自己名下的标题、优先级。
 * 有没接受的交接时改 assignee → 409，detail 原话照显示。已按后端 02935894 核对。
 */
export interface UpdateTodayTaskInput {
  title?: string;
  priority?: DailyTask["priority"];
  assigned_admin_user_id?: number | null;
}

export function updateTodayTask(
  id: number,
  input: UpdateTodayTaskInput,
): Promise<DailyTask> {
  return apiFetch<DailyTask>(`${TODAY}/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export interface AddTaskInput {
  title: string;
  priority?: DailyTask["priority"];
  /** admin_users.id（today.shifts[].admin_user_id 也有）；null = 不按 id 指定。和 assigned_to_username 都不传 = 全班共用。 */
  assigned_admin_user_id: number | null;
  /** 指定今天在班的某个人：shifts[].username 原样传（后端 G160，精确匹配区分大小写）。不存在或停用 → 400。 */
  assigned_to_username?: string;
  due_at: string | null;
}

/** 主管加今天的一次性任务（只有主管能调）。 */
export function addTask(input: AddTaskInput): Promise<DailyTask> {
  return apiFetch<DailyTask>(TODAY, { method: "POST", body: input });
}

export function fetchTaskTemplates(
  signal?: AbortSignal,
): Promise<TaskTemplate[]> {
  return apiFetch<TaskTemplate[]>(TEMPLATES, { cache: "no-store", signal });
}

export type TaskTemplateInput = Omit<TaskTemplate, "id">;

export function createTaskTemplate(
  input: TaskTemplateInput,
): Promise<TaskTemplate> {
  return apiFetch<TaskTemplate>(TEMPLATES, { method: "POST", body: input });
}

export function updateTaskTemplate(
  id: number,
  input: Partial<TaskTemplateInput>,
): Promise<TaskTemplate> {
  return apiFetch<TaskTemplate>(`${TEMPLATES}/${id}`, {
    method: "PATCH",
    body: input,
  });
}
