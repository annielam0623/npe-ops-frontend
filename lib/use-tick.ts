"use client";

import { usePageVisibility } from "@/lib/page-visibility";
import { byTick } from "@/lib/permissions";
import { usePermissions } from "@/lib/staff-permissions";

/**
 * 组件里直接问「这一项勾了没」：就是 `byTick(usePermissions(), codes, { superAdmin })`（只看勾，Annie 2026-11-01「动手」）。
 * 页面级的等待（perms.ready）由 PermissionGate 管，这里不再等。
 */
export function useTick(codes: string | readonly string[]): boolean {
  const perms = usePermissions();
  const { isSuperAdmin } = usePageVisibility();
  return byTick(perms, codes, { superAdmin: isSuperAdmin });
}
