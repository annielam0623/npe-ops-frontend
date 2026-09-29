import { apiFetch } from "@/lib/api-client";
import type { CurrentUser } from "@/types";

/** 未登录抛 401 的 ApiError；driver / guide 等非后台角色抛 403。 */
export function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUser> {
  return apiFetch<CurrentUser>("/api/me", { cache: "no-store", signal });
}
