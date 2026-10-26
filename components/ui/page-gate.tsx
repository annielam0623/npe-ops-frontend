"use client";

import { useCallback, useRef, type ReactNode } from "react";

import { CenteredPage } from "@/components/ui/centered-page";
import { usePageGates, type GateKey } from "@/lib/page-gates";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";

/**
 * 整页闸（Annie 2026-10-26：还没做好 / 点进去报错 / 没内容的模块仅 Super Admin 可见）：
 * 对我不可见就不画页面（也就不请求它的接口），只写一句「还没开放」；Super Admin 照常看到整页。
 */
export function PageGate({
  pageKey,
  children,
}: {
  pageKey: GateKey;
  children: ReactNode;
}) {
  const redirectingRef = useRef(false);
  const onUnauthorized = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);
  const gates = usePageGates(onUnauthorized);
  const visible = gates.visible(pageKey);

  if (!visible) {
    return (
      <CenteredPage>
        <div
          data-page-hidden={pageKey}
          className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm text-white/60"
        >
          {gates.loaded ? "This page is not available yet." : "Loading…"}
        </div>
      </CenteredPage>
    );
  }
  return <>{children}</>;
}
