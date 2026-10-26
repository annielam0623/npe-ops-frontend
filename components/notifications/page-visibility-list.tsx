"use client";

import { VisibilityControl } from "@/components/ui/visibility-control";
import {
  usePageVisibility,
  VISIBILITY_KEYS,
  type VisibilityKey,
} from "@/lib/page-visibility";

const KEYS = Object.keys(VISIBILITY_KEYS) as VisibilityKey[];

/**
 * Settings → Notifications 最下面的「Page visibility」（Annie 2026-10-25「从 my task 开始的所有新板块都要有这个开关，
 * 只有 super admin 可以控制」）：所有受控的新页面 / 新板块一行一个，名字 + 在哪 + 三档控件。
 * 只有 Super Admin 看得到整块。页面里各自的控件改的是同一份数据，两边一起变。
 */
export function PageVisibilityList({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const vis = usePageVisibility(onUnauthorized);
  if (!vis.isSuperAdmin) return null;

  return (
    <section data-page-visibility-list className="mt-[22px]">
      <div className="mb-2 text-[11.5px] font-bold tracking-[.08em] text-white/60 uppercase">
        Page visibility
      </div>
      <p className="mb-2.5 max-w-[78ch] text-[13px] text-white/60">
        Who can see each new page or block. Only Super Admin can change
        these.
      </p>
      <div className="rounded-[16px] border border-white/[.14] bg-[#0b1a2c]">
        {KEYS.map((key) => (
          <div
            key={key}
            data-visibility-row={key}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 border-b border-white/[.08] px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-[1_1_240px]">
              <div className="text-[14px] font-bold">
                {VISIBILITY_KEYS[key].label}
              </div>
              <div className="text-xs text-white/55">
                {VISIBILITY_KEYS[key].where}
              </div>
            </div>
            <VisibilityControl
              pageKey={key}
              onUnauthorized={onUnauthorized}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
