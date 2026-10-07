import { ApiError } from "@/types";

const NETWORK_ERROR_MESSAGE = "Network error. Please try again.";

/** 后端 HTTPException 的 detail 是给人看的原话（例如重名），优先直接显示。 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: unknown } | null;
    if (body && typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
    return `Request failed (${error.status}${error.statusText ? ` ${error.statusText}` : ""}).`;
  }
  if (error instanceof TypeError) {
    return NETWORK_ERROR_MESSAGE;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function isStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

/**
 * 还在用初始密码、必须先改密码的账号：后端 `_signed_in()` 不认 401，直接回 403「Password change
 * required」（后端待办 G32 第 4 条）。`lib/api-client.ts` 的 `apiFetch` 据此统一跳改密码页，
 * 不用每个调用点各自判断——这里单独导出只是给需要显示原因的地方用（目前没有）。
 */
export function isPasswordChangeRequired(error: unknown): boolean {
  if (!isStatus(error, 403)) return false;
  const body = (error as ApiError).body as { detail?: unknown } | null;
  return (
    typeof body?.detail === "string" && body.detail === "Password change required"
  );
}
