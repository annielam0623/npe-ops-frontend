import { apiFetch } from "@/lib/api-client";
import type {
  WorkspaceColleague,
  WorkspaceDestinations,
  WorkspaceDestinationSetting,
  WorkspaceGeneral,
  WorkspaceItem,
  WorkspaceItemList,
  WorkspaceItemPatch,
  WorkspaceSettings,
  WorkspaceStatus,
} from "@/types";

/**
 * My Workspace（后端 G66 阶段一，confirm `9392bf5`）。工作项接口 require_staff（所有 staff 都能看 Whole team、改任何一条）；
 * 设置接口 require_admin。输入不对回 400 {detail}，detail 是给 staff 看的一句话，原样显示。
 * ⚠️ ops 连生产：Generate 会真的建工作项。测试只用 ZZ Test 的文字。
 */

export function fetchDestinations(
  signal?: AbortSignal,
): Promise<WorkspaceDestinations> {
  return apiFetch("/api/workspace/destinations", { cache: "no-store", signal });
}

export async function fetchStatuses(
  signal?: AbortSignal,
): Promise<WorkspaceStatus[]> {
  const r = await apiFetch<{ statuses: WorkspaceStatus[] }>(
    "/api/workspace/statuses",
    { cache: "no-store", signal },
  );
  return r.statuses;
}

export async function fetchColleagues(
  signal?: AbortSignal,
): Promise<WorkspaceColleague[]> {
  const r = await apiFetch<{ colleagues: WorkspaceColleague[] }>(
    "/api/workspace/colleagues",
    { cache: "no-store", signal },
  );
  return r.colleagues;
}

/** status 不给 ⇒ 只有没关闭的。 */
export function fetchItems(
  scope: "mine" | "team",
  status: string | null,
  signal?: AbortSignal,
): Promise<WorkspaceItemList> {
  return apiFetch("/api/workspace/items", {
    cache: "no-store",
    signal,
    query: { scope, status: status || undefined },
  });
}

/**
 * Generate：建工作项并按去向的规则读取。粘贴的文字和文件二选一。
 * 读不出来不算错：回 200，item.read_error 写原因（工作项和原文照样存了）。
 */
export function createItem(input: {
  destinationId: number;
  text?: string;
  file?: File;
}): Promise<WorkspaceItem> {
  const form = new FormData();
  form.append("destination_id", String(input.destinationId));
  if (input.file) form.append("file", input.file);
  else form.append("text", input.text ?? "");
  return apiFetch("/api/workspace/items", { method: "POST", body: form });
}

export function fetchItem(
  id: number,
  signal?: AbortSignal,
): Promise<WorkspaceItem> {
  return apiFetch(`/api/workspace/items/${id}`, { cache: "no-store", signal });
}

export function updateItem(
  id: number,
  patch: WorkspaceItemPatch,
): Promise<WorkspaceItem> {
  return apiFetch(`/api/workspace/items/${id}`, { method: "PUT", body: patch });
}

export function assignItem(
  id: number,
  ownerId: number,
): Promise<WorkspaceItem> {
  return apiFetch(`/api/workspace/items/${id}/assign`, {
    method: "POST",
    body: { owner_id: ownerId },
  });
}

/** 按现在的规则重读。重读失败回 400（之前的结果保留）。 */
export function regenerateItem(id: number): Promise<WorkspaceItem> {
  return apiFetch(`/api/workspace/items/${id}/regenerate`, { method: "POST" });
}

/** 原文件下载（后端一律当附件）。浏览器直接打开这个同源地址，cookie 随请求带上。 */
export function fileDownloadUrl(itemId: number, fileId: number): string {
  return `/api/workspace/items/${itemId}/files/${fileId}`;
}

// ── Settings → My Workspace（admin）──

export function fetchWorkspaceSettings(
  signal?: AbortSignal,
): Promise<WorkspaceSettings> {
  return apiFetch("/api/settings/workspace", { cache: "no-store", signal });
}

export function saveDestination(
  id: number,
  body: Pick<
    WorkspaceDestinationSetting,
    | "name"
    | "description"
    | "accepts_text"
    | "accepts_file"
    | "is_enabled"
    | "sort_order"
  >,
): Promise<WorkspaceDestinationSetting> {
  return apiFetch(`/api/settings/workspace/destinations/${id}`, {
    method: "PUT",
    body,
  });
}

/** Draft 不能停用、不能设成已关闭（后端 400）。 */
export function saveStatus(
  code: string,
  body: Pick<
    WorkspaceStatus,
    "name" | "color" | "sort_order" | "is_active" | "is_closed"
  >,
): Promise<WorkspaceStatus> {
  return apiFetch(
    `/api/settings/workspace/statuses/${encodeURIComponent(code)}`,
    { method: "PUT", body },
  );
}

/** 后端回的是 upload_max_bytes（不是 MB），这里换回页面用的形状。 */
export async function saveGeneral(
  body: WorkspaceGeneral,
): Promise<WorkspaceGeneral> {
  const r = await apiFetch<{
    item_prefix: string;
    upload_max_bytes: number;
    upload_types: string[];
  }>("/api/settings/workspace/general", { method: "PUT", body });
  return {
    item_prefix: r.item_prefix,
    upload_max_mb: Math.round((r.upload_max_bytes / 1024 / 1024) * 100) / 100,
    upload_types: r.upload_types,
  };
}
