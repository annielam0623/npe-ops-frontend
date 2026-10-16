import { apiFetch } from "@/lib/api-client";
import type { DailyTask, TasksToday, TaskTemplate } from "@/types";

/**
 * 任务框（阶段三）。后端还没有这些接口（2026-10-16），形状是 ops 按任务包自己设计的草案，
 * 等后端接口定了再核对字段名、改这个文件（页面代码不用动，照样走这几个函数）。
 */
const TODAY = "/api/tasks/today";
const TEMPLATES = "/api/tasks/templates";

/** 今天的任务：员工只看自己的 + 待接受的交接；主管看全部 + 交接通知（is_supervisor_view 由后端按身份判断）。 */
export function fetchTasksToday(signal?: AbortSignal): Promise<TasksToday> {
  return apiFetch<TasksToday>(TODAY, { cache: "no-store", signal });
}

/** 勾 / 取消勾选完成（员工、主管都能勾自己能看到的任务）。 */
export function toggleTaskDone(
  id: number,
  done: boolean,
): Promise<DailyTask> {
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

/** Pass over：写交接说明，发给下一班的人；任务仍在我名下，直到对方 Accept。 */
export function passOverTask(id: number, note: string): Promise<DailyTask> {
  return apiFetch<DailyTask>(`${TODAY}/${id}/pass-over`, {
    method: "POST",
    body: { note },
  });
}

/** 下一班的人 Accept：没有拒绝，接受后任务转到他名下。 */
export function acceptPassOver(id: number): Promise<DailyTask> {
  return apiFetch<DailyTask>(`${TODAY}/${id}/accept`, { method: "POST" });
}

export interface AddTaskInput {
  title: string;
  role: DailyTask["role"];
  assigned_to_username: string | null;
  due_at: string | null;
}

/** 主管加任务：选岗位或具体某人，今天 / 明天 / 每天由调用方决定要不要同时存模板。 */
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
