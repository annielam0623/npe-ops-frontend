"use client";

import { usePageVisibility } from "@/lib/page-visibility";
import { byTick } from "@/lib/permissions";
import { usePermissions } from "@/lib/staff-permissions";

/**
 * 组件里直接问「这一项勾了没」：就是 `byTick(usePermissions(), codes, { legacy, superAdmin })`（Annie 2026-10-30 置顶 10c）。
 * `legacy` 默认 true：员工本来一律有键、后端按勾的那些地方（10c 的 C 类：发送键、编辑键），总开关关着时照旧全给。
 * 页面级的等待（perms.ready）由 PermissionGate 管，这里不再等。
 */
export function useTick(
  codes: string | readonly string[],
  legacy = true,
): boolean {
  const perms = usePermissions();
  const { isSuperAdmin } = usePageVisibility();
  return byTick(perms, codes, { legacy, superAdmin: isSuperAdmin });
}
