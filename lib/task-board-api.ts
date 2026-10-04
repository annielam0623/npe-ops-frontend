import { apiFetch } from "@/lib/api-client";
import type {
  BugTaskList,
  ClickUpDoc,
  TaskBoardAssigned,
  TaskBoardCreate,
  TaskBoardLists,
} from "@/types";

/**
 * Task Board：ClickUp 里 Supplier 文件夹的只读看板 + 在 Requirement pool / Bug pool 新建任务。
 * ⚠️ 新建、评论、附件都写进**线上 ClickUp**（共用一个账号），本系统删不掉。全部 require_staff。
 * 评论 / 附件 / 任务详情用 Bug Reports 那几个接口（lib/bug-reports-api.ts）。
 * ClickUp 出错是 502 `{err, upstream_status, upstream_err}`，用 describeClickUpError 显示。
 */
const API = "/api/task-board";

export function fetchTaskBoardLists(
  signal?: AbortSignal,
): Promise<TaskBoardLists> {
  return apiFetch<TaskBoardLists>(`${API}/lists`, {
    cache: "no-store",
    signal,
  });
}

/** 一个列表的全部任务（含已完成）；list_id 必须在 Supplier 文件夹里，否则 403。 */
export function fetchTaskBoardTasks(
  listId: string,
  signal?: AbortSignal,
): Promise<BugTaskList> {
  return apiFetch<BugTaskList>(`${API}/tasks`, {
    cache: "no-store",
    signal,
    query: { list_id: listId },
  });
}

export function fetchTaskBoardAssigned(
  signal?: AbortSignal,
): Promise<TaskBoardAssigned> {
  return apiFetch<TaskBoardAssigned>(`${API}/assigned`, {
    cache: "no-store",
    signal,
  });
}

export async function fetchTaskBoardDocs(
  signal?: AbortSignal,
): Promise<ClickUpDoc[]> {
  const result = await apiFetch<{ docs: ClickUpDoc[] }>(`${API}/docs`, {
    cache: "no-store",
    signal,
  });
  return result.docs;
}

/** 能指派的人（只有 Requirement pool / Bug pool 能新建）。 */
export async function fetchTaskBoardMembers(
  listId: string,
): Promise<{ id: number; username: string }[]> {
  const result = await apiFetch<{
    members: { id: number; username: string }[];
  }>(`${API}/members`, { cache: "no-store", query: { list_id: listId } });
  return result.members;
}

/** 提交人由后端按当前登录的人写进说明（[Reported by: …]），前端不传。 */
export function createTaskBoardTask(
  body: TaskBoardCreate,
): Promise<{ id?: string }> {
  return apiFetch(`${API}/tasks`, { method: "POST", body });
}
