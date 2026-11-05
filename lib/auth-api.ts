import { apiFetch } from "@/lib/api-client";
import { shareRequest } from "@/lib/shared-request";
import type { CurrentUser } from "@/types";

/**
 * 全站共用一份 /api/me（页面提速，Annie 2026-11-05「改变速度的三步，动手」）：
 * 外框、page-visibility、各页面同时要「我是谁」时只发一个请求，站内换页也不重读；整页刷新才重读。
 * 失败（401、断网……）不留：下一个调用者重新发。signal 只管这个调用者。
 * 未登录抛 401 的 ApiError；driver / guide 等非后台角色抛 403。
 */
export function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUser> {
  return shareRequest(
    "/api/me",
    () => apiFetch<CurrentUser>("/api/me", { cache: "no-store" }),
    Infinity,
    signal,
  );
}
