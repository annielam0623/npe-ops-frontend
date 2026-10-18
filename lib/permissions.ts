import type { CurrentUser } from "@/types";

/**
 * 页面 / 侧栏的「谁能看、谁能改」判断都收在这个文件里（Annie 2026-10-18 要做「按人分配权限」，
 * 到时候只换这里的函数，不用到处改 `is_admin` / `is_supervisor`）。后端仍然自己挡，这里只决定显示什么。
 */
type PermissionUser = Pick<CurrentUser, "is_admin" | "is_supervisor">;

/** Human Resource：supervisor 及以上能看，所有字段（Annie 2026-10-17：内部系统，不脱敏）。 */
export function canSeeHr(me: PermissionUser): boolean {
  return me.is_admin || me.is_supervisor === true;
}

/** Human Resource 的增删改、批量改、导入、导出：仍然只有 admin（主管默认只读）。 */
export function canEditHr(me: PermissionUser): boolean {
  return me.is_admin;
}

/** 侧栏 Settings 组：admin 看全部；主管只看到标了 `supervisorVisible` 的项（目前只有 Human Resource）。 */
export function canSeeSettingsItem(
  me: PermissionUser,
  item: { supervisorVisible?: boolean },
): boolean {
  return me.is_admin || (me.is_supervisor === true && !!item.supervisorVisible);
}
