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
