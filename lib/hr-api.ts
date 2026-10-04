import { apiFetch } from "@/lib/api-client";
import {
  ApiError,
  type HRBulkResult,
  type HRImportPreview,
  type HRImportResult,
  type HRLinkableUser,
  type HRLogEntry,
  type HRProfile,
} from "@/types";

/**
 * Settings → Human Resource。全部 require_admin。
 * ⚠️ 没有并发控制：单个保存是整行覆盖（后存的赢），Edit list 只写改过的格子。
 */
const API = "/api/hr";

export const HR_LOG_LIMIT = 50;

export async function fetchHRProfiles(
  signal?: AbortSignal,
): Promise<HRProfile[]> {
  const result = await apiFetch<{ profiles: HRProfile[] }>(`${API}/profiles`, {
    cache: "no-store",
    signal,
  });
  return result.profiles;
}

/** 还没被人占用、启用中的 driver / guide 账号；已经关联的那个不在里面。 */
export async function fetchLinkableUsers(
  signal?: AbortSignal,
): Promise<HRLinkableUser[]> {
  const result = await apiFetch<{ users: HRLinkableUser[] }>(
    `${API}/linkable-users`,
    { cache: "no-store", signal },
  );
  return result.users;
}

export async function fetchHRLog(signal?: AbortSignal): Promise<HRLogEntry[]> {
  const result = await apiFetch<{ entries: HRLogEntry[] }>(`${API}/log`, {
    cache: "no-store",
    signal,
    query: { limit: HR_LOG_LIMIT },
  });
  return result.entries;
}

/** 整行：每个字段都要带（没带的按空处理），user_id 为 null 就是不关联。 */
export interface HRProfileInput {
  user_id: number | null;
  [field: string]: string | string[] | number | null;
}

export async function createHRProfile(input: HRProfileInput): Promise<number> {
  const result = await apiFetch<{ id: number }>(`${API}/profiles`, {
    method: "POST",
    body: input,
  });
  return result.id;
}

export async function updateHRProfile(
  id: number,
  input: HRProfileInput,
): Promise<void> {
  await apiFetch(`${API}/profiles/${id}`, { method: "PUT", body: input });
}

/**
 * 删除。这个人今天或以后还在排班表上、又没带 confirmSchedule 时，
 * 后端回 409 `{detail: {needs_confirm, message}}`，用 {@link scheduleConfirmOf} 取出提示。
 */
export async function deleteHRProfile(
  id: number,
  confirmSchedule = false,
): Promise<void> {
  await apiFetch(`${API}/profiles/${id}`, {
    method: "DELETE",
    query: confirmSchedule ? { confirm_schedule: "true" } : undefined,
  });
}

export function scheduleConfirmOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const detail = (error.body as { detail?: unknown } | null)?.detail as
    { needs_confirm?: boolean; message?: string } | undefined;
  return detail?.needs_confirm && detail.message ? detail.message : null;
}

/** Edit list：每行只带改过的列（多选是逗号分隔的值）。整批一个事务，一行出错全部不存。 */
export function saveHRBulk(
  edits: Array<Record<string, string | number>>,
): Promise<HRBulkResult> {
  return apiFetch<HRBulkResult>(`${API}/profiles/bulk`, {
    method: "POST",
    body: { edits },
  });
}

/** bulk 校验失败时 detail 是 `{message, profile_id}`。 */
export function bulkErrorOf(
  error: unknown,
): { message: string; profileId: number | null } | null {
  if (!(error instanceof ApiError)) return null;
  const detail = (error.body as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as { message?: unknown; profile_id?: unknown };
    if (typeof d.message === "string") {
      return {
        message: d.message,
        profileId: typeof d.profile_id === "number" ? d.profile_id : null,
      };
    }
  }
  return null;
}

/** 导出 Excel（POST；列固定，不含驾照号、生日、邮箱、紧急联系人、备注）。 */
export async function downloadHRExport(): Promise<{
  blob: Blob;
  filename: string;
}> {
  const res = await fetch(`${API}/export`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename =
    /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "NPE_Driver_List.xlsx";
  return { blob: await res.blob(), filename };
}

function importForm(file: File, overwrite: boolean): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("overwrite", overwrite ? "true" : "false");
  return form;
}

/** 只读预览，不写库。 */
export function previewHRImport(
  file: File,
  overwrite: boolean,
  signal?: AbortSignal,
): Promise<HRImportPreview> {
  return apiFetch<HRImportPreview>(`${API}/import-preview`, {
    method: "POST",
    body: importForm(file, overwrite),
    signal,
  });
}

/** 后端会重新解析文件，所以要再传一次同一个文件和同一个 overwrite。 */
export function commitHRImport(
  file: File,
  overwrite: boolean,
): Promise<HRImportResult> {
  return apiFetch<HRImportResult>(`${API}/import-commit`, {
    method: "POST",
    body: importForm(file, overwrite),
  });
}
