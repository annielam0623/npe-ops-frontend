import { apiFetch } from "@/lib/api-client";
import type { CurrentUser } from "@/types";

/**
 * 全站共用一份 /api/me（页面提速，Annie 2026-11-05「改变速度的三步，动手」）：
 * 外框、page-visibility、各页面同时要「我是谁」时只发一个请求，站内换页也不重读；整页刷新才重读。
 * 失败（401、断网……）不留：下一个调用者重新发。
 * signal 只管这个调用者——它取消了不影响别人在等的那一份。
 */
let shared: Promise<CurrentUser> | null = null;

/** 未登录抛 401 的 ApiError；driver / guide 等非后台角色抛 403。 */
export function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUser> {
  if (!shared) {
    const p = apiFetch<CurrentUser>("/api/me", { cache: "no-store" });
    shared = p;
    p.catch(() => {
      if (shared === p) shared = null;
    });
  }
  return withSignal(shared, signal);
}

function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}
