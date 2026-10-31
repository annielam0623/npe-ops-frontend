/**
 * 「全部按照勾选」（Annie 2026-10-30 置顶 10c「动手」）：页面上谁看得到某个键 / 某一页，照后端那个接口要的权限码判断。
 *
 * - Super Admin：一律看得到（后端也是一律放行）。
 * - 员工权限总开关 staff_permissions 对这个人开着（`perms.active`）：只按勾，admin 不再自动有（后端除 Super Admin 外都按勾）。
 * - 总开关关着：照今天的规矩（调用方传进来的 `legacy`，例如 `me.is_admin`），页面和今天一模一样——
 *   不能用「关着时 can() 一律 true」，那样关着的今天，原来只给 admin 的整页会一下子对所有员工打开。
 *
 * 不依赖别的模块（checks/headless/by-tick-unit.mjs 直接 import 这个文件）。`perms` 还没 ready 时由调用方先等。
 */
export interface TickPerms {
  /** 正在按勾（总开关对我开着、权限读到了、我不是 Super Admin）。见 lib/staff-permissions.ts `usePermissions().active`。 */
  active: boolean;
  /** 任一项勾了就行。 */
  canAny: (codes: readonly string[]) => boolean;
}

export function byTick(
  perms: TickPerms,
  codes: string | readonly string[],
  opts: {
    /** 总开关关着时照旧的判断（例如 `me.is_admin`、`me.is_supervisor === true`）。 */
    legacy: boolean;
    superAdmin: boolean;
  },
): boolean {
  if (opts.superAdmin) return true;
  if (!perms.active) return opts.legacy;
  return perms.canAny(typeof codes === "string" ? [codes] : codes);
}
