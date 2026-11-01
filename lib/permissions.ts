import { describeError, isStatus } from "@/lib/api-errors";
import type { CurrentUser } from "@/types";
export { byTick, type TickPerms } from "@/lib/by-tick";

/**
 * 页面 / 侧栏的「谁能看、谁能改」判断都收在这个文件里（Annie 2026-10-18 要做「按人分配权限」，
 * 到时候只换这里的函数，不用到处改 `is_admin` / `is_supervisor`）。后端仍然自己挡，这里只决定显示什么。
 */
type PermissionUser = Pick<CurrentUser, "is_admin" | "is_supervisor">;

/** HR 写操作出错时的文字：被后端拒绝（403）给友好提示，其余错误照旧用后端原话。 */
export function describeHrWriteError(error: unknown): string {
  if (isStatus(error, 403)) {
    return "Your account can't change Human Resource records yet. Nothing was changed — ask an admin to make the change.";
  }
  return describeError(error);
}

/**
 * 侧栏 Settings 组里**后端还按角色挡**的页（Team、Notifications、Quick Replies、Supplier……）：admin 看全部；
 * 主管只看到标了 `supervisorVisible` 的项。有权限码的页（lib/staff-permissions.ts ROUTE_PERMISSIONS）只按勾，不走这里
 * （只看勾，Annie 2026-11-01「动手」；HR 看 settings.hr.view、改 settings.hr.edit）。
 */
export function canSeeSettingsItem(
  me: PermissionUser,
  item: { supervisorVisible?: boolean },
): boolean {
  return me.is_admin || (me.is_supervisor === true && !!item.supervisorVisible);
}
