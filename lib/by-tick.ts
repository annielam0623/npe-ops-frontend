/**
 * 「全部按照勾选」（Annie 2026-10-30 置顶 10c「动手」）：页面上谁看得到某个键 / 某一页，照后端那个接口要的权限码判断。
 * 只看勾（Annie 2026-10-31「只看勾，不兜底」，2026-11-01「动手」；后端 64 a987105a）：
 *
 * - Super Admin：一律看得到（后端也是一律放行）。
 * - 其余：只照 `GET /api/me/permissions` 的列表（后端已算好角色标准和特批开关），不叠角色、不读总开关。
 * - 后端还按角色挡的接口（Team、Quick replies、Bus Manifest setup、Publish anyway……）不走这里，调用方照旧看角色。
 *
 * 不依赖别的模块（checks/headless/by-tick-unit.mjs 直接 import 这个文件）。`perms` 还没 ready 时由调用方先等。
 */
export interface TickPerms {
  /** 正在按勾（权限读到了、我不是 Super Admin）。读不到时员工照旧不藏。见 lib/staff-permissions.ts `usePermissions().active`。 */
  active: boolean;
  /** 任一项勾了就行。 */
  canAny: (codes: readonly string[]) => boolean;
}

export function byTick(
  perms: TickPerms,
  codes: string | readonly string[],
  opts: { superAdmin: boolean },
): boolean {
  if (opts.superAdmin) return true;
  return perms.canAny(typeof codes === "string" ? [codes] : codes);
}
