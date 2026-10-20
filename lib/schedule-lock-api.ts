import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/types";

/**
 * 排班同一周同时只能一个人编辑（Annie 2026-10-19「动手改才提示」：先让人打开看，动手改时才提示
 * 「谁在编辑、请稍后再试」，同 Dispatch 的 edit-lock）。后端已上线（2026-10-20，`npe-confirmation-service`
 * `4368567`，`app/services/schedule_edit_lock.py`，接口说明 `docs/interfaces/schedule-wed-confirm-2026-10-20.md`）。
 * 404 / 405 / 501 当没有这个功能：不占用、不弹、不报错（`isLockUnavailable`，兼容老环境）。
 */
const base = (week: string) => `/api/schedule/weeks/${week}/edit-lock`;

/** 占住这一周。别人在改 ⇒ 409，detail 一句话（写着是谁）。 */
export function acquireScheduleLock(
  week: string,
): Promise<{ token: string; heartbeat_every_s?: number }> {
  return apiFetch(base(week), { method: "POST", body: {} });
}

/** 占住期间每隔一会儿一次；409 = 编辑已结束（超时 / 重启 / 别的标签页接走）。 */
export function scheduleLockHeartbeat(
  week: string,
  token: string,
  edited: boolean,
): Promise<{ ok: boolean }> {
  return apiFetch(`${base(week)}/heartbeat`, {
    method: "POST",
    body: { token, edited },
  });
}

export function releaseScheduleLock(
  week: string,
  token: string,
): Promise<{ released: boolean }> {
  return apiFetch(`${base(week)}/release`, { method: "POST", body: { token } });
}

/** 关页面 / 离开时放开：keepalive 让请求在页面卸载后照样发出去。 */
export function releaseScheduleLockOnLeave(week: string, token: string): void {
  try {
    void fetch(`${base(week)}/release`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  } catch {
    // 放不开也没关系：心跳断了服务器会自己放开。
  }
}

export function isLockUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 405 || error.status === 501)
  );
}
