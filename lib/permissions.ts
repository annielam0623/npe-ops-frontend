import { describeError, isStatus } from "@/lib/api-errors";
import type { CurrentUser } from "@/types";
export { byTick, type TickPerms } from "@/lib/by-tick";

/**
 * 页面 / 侧栏的「谁能看、谁能改」判断都收在这个文件里（Annie 2026-10-18 要做「按人分配权限」，
 * 到时候只换这里的函数，不用到处改 `is_admin` / `is_supervisor`）。后端仍然自己挡，这里只决定显示什么。
 */
type PermissionUser = Pick<CurrentUser, "is_admin" | "is_supervisor">;

/** Human Resource：supervisor 及以上能看，所有字段（Annie 2026-10-17：内部系统，不脱敏）。 */
export function canSeeHr(me: PermissionUser): boolean {
  return me.is_admin || me.is_supervisor === true;
}

/**
 * Human Resource 的增删改、批量改、导入、导出：主管也能改（Annie 2026-10-17：「主管在 HR 里能改」）。
 * ⚠️ 后端的写接口目前仍然只有 admin；主管点了会 403，页面用 `describeHrWriteError` 给友好提示，
 * 后端开放后不用再改页面。
 */
export function canEditHr(me: PermissionUser): boolean {
  return canSeeHr(me);
}

/** HR 写操作出错时的文字：被后端拒绝（403）给友好提示，其余错误照旧用后端原话。 */
export function describeHrWriteError(error: unknown): string {
  if (isStatus(error, 403)) {
    return "Your account can't change Human Resource records yet. Nothing was changed — ask an admin to make the change.";
  }
  return describeError(error);
}

/** 侧栏 Settings 组：admin 看全部；主管只看到标了 `supervisorVisible` 的项（目前只有 Human Resource）。 */
export function canSeeSettingsItem(
  me: PermissionUser,
  item: { supervisorVisible?: boolean },
): boolean {
  return me.is_admin || (me.is_supervisor === true && !!item.supervisorVisible);
}
