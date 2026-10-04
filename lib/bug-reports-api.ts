import { apiFetch } from "@/lib/api-client";
import { describeError } from "@/lib/api-errors";
import {
  ApiError,
  type BugTaskCreate,
  type BugTaskList,
  type ClickUpComment,
  type ClickUpTaskDetail,
} from "@/types";

/**
 * Bug Reports 是 ClickUp 的代理：**每一次写都进线上 ClickUp**（TripGuru-Dev 的 Bug list），
 * 不是沙箱；本系统删不掉建出来的任务、评论、附件。全部 require_staff。
 * ⚠️ /api/bug-reports/task/{id}/comment、/attachment 也被 Task Board 用，后端不能随便改。
 */
const API = "/api/bug-reports";

export function fetchBugTasks(signal?: AbortSignal): Promise<BugTaskList> {
  return apiFetch<BugTaskList>(`${API}/tasks`, { cache: "no-store", signal });
}

/** 任务详情；页面只用它的 attachments（和评论配对出缩略图）。 */
export function fetchBugTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<ClickUpTaskDetail> {
  return apiFetch<ClickUpTaskDetail>(
    `${API}/task/${encodeURIComponent(taskId)}`,
    { cache: "no-store", signal },
  );
}

export function createBugTask(body: BugTaskCreate): Promise<{ id?: string }> {
  return apiFetch(`${API}/tasks`, { method: "POST", body });
}

/** 新的在前。 */
export async function fetchBugComments(
  taskId: string,
  signal?: AbortSignal,
): Promise<ClickUpComment[]> {
  const result = await apiFetch<{ comments?: ClickUpComment[] }>(
    `${API}/task/${encodeURIComponent(taskId)}/comment`,
    { cache: "no-store", signal },
  );
  return result.comments ?? [];
}

export async function postBugComment(
  taskId: string,
  commentText: string,
): Promise<void> {
  await apiFetch(`${API}/task/${encodeURIComponent(taskId)}/comment`, {
    method: "POST",
    body: { comment_text: commentText },
  });
}

/** 上传一个附件（后端读进内存转给 ClickUp，不存文件）。返回 ClickUp 上的地址。 */
export async function uploadBugAttachment(
  taskId: string,
  file: File,
): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  const result = await apiFetch<{ url?: string }>(
    `${API}/task/${encodeURIComponent(taskId)}/attachment`,
    { method: "POST", body: form },
  );
  return result.url ?? null;
}

/**
 * ClickUp 出错时后端回 502 `{err, where, upstream_status, upstream_err?}`（不是 detail），
 * upstream_err 是 ClickUp 给的原因，要显示给人看。
 */
export function describeClickUpError(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as {
      upstream_status?: number;
      upstream_err?: string;
    } | null;
    if (body && (body.upstream_err || body.upstream_status)) {
      return body.upstream_err
        ? `HTTP ${error.status}: ${body.upstream_err}`
        : `HTTP ${error.status} (ClickUp returned ${body.upstream_status})`;
    }
  }
  return describeError(error);
}
