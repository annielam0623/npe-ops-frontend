"use client";

import { useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  usePageVisibility,
  VISIBILITY_HINT,
  type Visibility,
  type VisibilityKey,
} from "@/lib/page-visibility";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Visibility; label: string }[] = [
  { value: "staff", label: "Everyone" },
  { value: "admin", label: "Admins" },
  { value: "super_admin_only", label: "Super Admin only" },
];

/** 选中那一档的颜色：所有人 = 绿，只 admin = 琥珀，只 Super Admin = 灰。不用蓝色（蓝色只给提交键）。 */
const SELECTED: Record<Visibility, string> = {
  staff: "border-[#4ade80] bg-[#4ade80]/[.18] text-[#4ade80]",
  admin: "border-[#fbbf24] bg-[#fbbf24]/[.16] text-[#fbbf24]",
  super_admin_only: "border-[#cbd5e1] bg-white/[.14] text-white",
};
const SELECTED_LIGHT: Record<Visibility, string> = {
  staff: "border-[#1a7f4b] bg-[#e3f5ea] text-[#1a7f4b]",
  admin: "border-[#b7791f] bg-[#fff3d6] text-[#8a5a00]",
  super_admin_only: "border-[#475569] bg-[#e2e8f0] text-[#1e293b]",
};

/**
 * 「Visible to: Everyone / Admins / Super Admin only」三档（Annie 2026-10-25：只有 Super Admin 可以控制）。
 * 只有 Super Admin 看得到这个控件；其他人什么都不画。放在板块 / 页面标题行右侧。
 * 下面一行写这一档到底谁看得到；改不成写后端原话（例如 key 还没登记）。
 */
export function VisibilityControl({
  pageKey,
  tone = "dark",
  onUnauthorized,
  showHint = true,
}: {
  pageKey: VisibilityKey;
  /** 深色底（Dashboard、外框）还是白卡片上。 */
  tone?: "dark" | "light";
  onUnauthorized?: () => void;
  showHint?: boolean;
}) {
  const vis = usePageVisibility(onUnauthorized);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!vis.isSuperAdmin) return null;
  const current = vis.visibilityOf(pageKey);
  const light = tone === "light";

  async function choose(v: Visibility) {
    if (busy || v === current) return;
    setBusy(true);
    setError("");
    try {
      await vis.setVisibility(pageKey, v);
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized?.();
      else setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span
      data-visibility-control={pageKey}
      className="inline-flex max-w-full flex-col items-end gap-1"
    >
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs">
        <span
          className={cn(
            "font-semibold",
            light ? "text-stone-600" : "text-white/65",
          )}
        >
          Visible to
        </span>
        <span
          role="radiogroup"
          aria-label="Who can see this"
          className="inline-flex flex-wrap gap-1"
        >
          {OPTIONS.map((o) => {
            const on = o.value === current;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                data-visibility={o.value}
                disabled={busy}
                onClick={() => void choose(o.value)}
                title={VISIBILITY_HINT[o.value]}
                className={cn(
                  "cursor-pointer rounded-[7px] border px-2 py-[2px] text-[11.5px] font-bold disabled:cursor-default disabled:opacity-60",
                  on
                    ? (light ? SELECTED_LIGHT : SELECTED)[o.value]
                    : light
                      ? "border-stone-300 bg-white text-stone-600 hover:border-stone-500"
                      : "border-white/20 bg-transparent text-white/70 hover:border-white/45",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </span>
      </span>
      {showHint ? (
        <span
          data-visibility-hint
          className={cn(
            "text-[11px]",
            light ? "text-stone-500" : "text-white/55",
          )}
        >
          {VISIBILITY_HINT[current]}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-[11.5px] text-[#f87171]">
          Could not change who can see this: {error}
        </span>
      ) : null}
    </span>
  );
}
