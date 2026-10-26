"use client";

import { useCallback, useRef, type ReactNode } from "react";

import { CenteredPage } from "@/components/ui/centered-page";
import { usePageVisibility, type VisibilityKey } from "@/lib/page-visibility";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";

import { VisibilityControl } from "./visibility-control";

/**
 * 整页的可见性（Annie 2026-10-25「从 my task 开始的所有新板块都要有这个开关，只有 super admin 可以控制」）：
 * - 对我不可见：不画页面（也就不请求它的接口），只写一句「还没开放」，样子同 Daily Operation Report 页。
 * - Super Admin：页面最上面右侧多一行「Visible to: Everyone / Admins / Super Admin only」。
 * 还没读完时：默认员工可见的页面照常画（不闪），其余先写 Loading…。
 */
export function PageVisibilityGate({
  pageKey,
  children,
}: {
  pageKey: VisibilityKey;
  children: ReactNode;
}) {
  const redirectingRef = useRef(false);
  const onUnauthorized = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);
  const vis = usePageVisibility(onUnauthorized);
  const visible = vis.visible(pageKey);

  if (!visible) {
    return (
      <CenteredPage>
        <div
          data-page-hidden={pageKey}
          className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm text-white/60"
        >
          {vis.loaded ? "This page is not available yet." : "Loading…"}
        </div>
      </CenteredPage>
    );
  }
  return (
    <>
      {vis.isSuperAdmin ? (
        <CenteredPage className="mb-3 flex justify-end print:hidden">
          <VisibilityControl
            pageKey={pageKey}
            onUnauthorized={onUnauthorized}
          />
        </CenteredPage>
      ) : null}
      {children}
    </>
  );
}
