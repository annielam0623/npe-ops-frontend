import { apiFetch } from "@/lib/api-client";
import type { ImportCommitResult, ImportPreviewResponse } from "@/types";

function form(file: File): FormData {
  const f = new FormData();
  f.append("file", file);
  return f;
}

/** `<base>/preview`：只读，不写库。 */
export function previewImport(
  base: string,
  file: File,
  signal?: AbortSignal,
): Promise<ImportPreviewResponse> {
  return apiFetch<ImportPreviewResponse>(`${base}/preview`, {
    method: "POST",
    body: form(file),
    signal,
  });
}

/** `<base>/commit`：后端重新解析同一个文件，只写 new / update 行，一个事务。 */
export function commitImport(
  base: string,
  file: File,
): Promise<ImportCommitResult> {
  return apiFetch<ImportCommitResult>(`${base}/commit`, {
    method: "POST",
    body: form(file),
  });
}
