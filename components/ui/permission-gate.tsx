"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { CenteredPage } from "@/components/ui/centered-page";
import { requiredForPath, usePermissions } from "@/lib/staff-permissions";

/**
 * 整页按员工权限拦（lib/permissions.ts）：
 * - 结果没定：先写 Loading…，不画页面（也就不请求它的接口）。
 * - 没有这页的项：只写「You don't have access to this page.」（Annie 2026-10-26 preview Q2 B），样子同 PageVisibilityGate。
 * - 没有 dashboard.view 的人打开 Dashboard：换到 Settings › Team 给他设的首页（default_home；partner 没设就去 /forecast）。
 * 总开关关着时：等总开关读完（和侧栏同一个请求）就照旧画页面。
 */
export function PermissionGate({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const perms = usePermissions();
  const allowed = perms.canOpen(pathname);
  // 只有打开 Dashboard（登录后默认落在这里）才换去首页；别的没勾的页面写「没有权限」。
  const home =
    !allowed &&
    pathname === "/dashboard" &&
    perms.defaultHome &&
    perms.defaultHome !== pathname
      ? perms.defaultHome
      : null;
  const goHome = perms.ready && home !== null && perms.canOpen(home);

  useEffect(() => {
    if (goHome && home) router.replace(home);
  }, [goHome, home, router]);

  // 谁都不拦的页面（例如不用登录的确认排班链接页）不等。不在权限表里的页面要等：partner 不给开。
  if (requiredForPath(pathname) === null) return <>{children}</>;
  if (!perms.ready || goHome) {
    return (
      <CenteredPage>
        <div className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm text-white/60">
          Loading…
        </div>
      </CenteredPage>
    );
  }
  if (!allowed) {
    return (
      <CenteredPage>
        <div
          data-no-access
          className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm text-white/60"
        >
          You don&apos;t have access to this page.
        </div>
      </CenteredPage>
    );
  }
  return <>{children}</>;
}
