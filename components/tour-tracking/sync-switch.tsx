"use client";

import { type ReactNode, useEffect, useState } from "react";

import { PhoneMore } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import { usePageVisibility } from "@/lib/page-visibility";
import {
  fetchTrackingSync,
  saveTrackingSync,
  type TrackingSyncMode,
} from "@/lib/tracking-sync-api";

/**
 * 置顶 95（Annie「全按推荐，动手」，preview https://claude.ai/artifact/7DDLeUsSSczzovwb2pncrb 三题全 A）：
 * Tour Tracking 日期那一行最右边一个小下拉「Main manifest sync」，只给 Super Admin；选了就存（绿字 Saved、页面重读），
 * 切到 Staff 先出黄框确认。读不到（不是 Super Admin / 旧后端）⇒ 不出。手机上收进「⋯」。How to use 不提。
 */

const LABEL: Record<TrackingSyncMode, string> = {
  off: "Off",
  super_admin_only: "Super Admin only",
  staff: "Staff",
};

/** 下拉下面那一行（题 3 A 原文，随档位变）。 */
export const SYNC_HELP: Record<TrackingSyncMode, string> = {
  off: "Off: orders that have not been sent yet don't show here, and there is no Order Status column. The page works as before.",
  super_admin_only:
    "Super Admin only: you see grey rows and Order Status. Staff still see the page as before.",
  staff:
    "Staff: everyone who can open this page sees grey rows and Order Status.",
};

const SELECT =
  "cursor-pointer rounded-lg border border-[#d0e0d4] bg-paper px-2 py-[4px] font-[inherit] text-[12.5px] font-semibold text-[#1f2d25] outline-none focus:border-[#2f5e46] disabled:opacity-60";

export function useTrackingSyncSwitch(onChanged: () => void): {
  control: ReactNode;
  below: ReactNode;
} {
  const { isSuperAdmin, loaded } = usePageVisibility();
  const [mode, setMode] = useState<TrackingSyncMode | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!loaded || !isSuperAdmin) return;
    const ac = new AbortController();
    fetchTrackingSync(ac.signal)
      .then((s) => {
        if (s && s.mode in LABEL) setMode(s.mode);
      })
      .catch(() => {
        // 403 / 404（旧后端）⇒ 不出下拉。
      });
    return () => ac.abort();
  }, [loaded, isSuperAdmin]);

  async function save(next: TrackingSyncMode) {
    setSaving(true);
    setResult(null);
    try {
      const s = await saveTrackingSync(next);
      setMode(s.mode in LABEL ? s.mode : next);
      setResult({ ok: true, text: "Saved" });
      onChanged();
    } catch (e) {
      setResult({
        ok: false,
        text: isStatus(e, 401) ? "Please sign in again." : describeError(e),
      });
    } finally {
      setSaving(false);
      setAsking(false);
    }
  }

  if (!isSuperAdmin || mode === null) return { control: null, below: null };

  const select = (
    <select
      aria-label="Main manifest sync"
      value={asking ? "staff" : mode}
      disabled={saving}
      onChange={(e) => {
        const next = e.target.value as TrackingSyncMode;
        setResult(null);
        if (next === mode) return;
        if (next === "staff") setAsking(true);
        else {
          setAsking(false);
          void save(next);
        }
      }}
      className={SELECT}
    >
      {(Object.keys(LABEL) as TrackingSyncMode[]).map((m) => (
        <option key={m} value={m}>
          {LABEL[m]}
        </option>
      ))}
    </select>
  );
  const inner = (
    <span
      data-sync-switch
      className="inline-flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[#b9c9bd] bg-paper px-2.5 py-1"
    >
      <span className="text-[12.5px] font-bold text-[#2f5e46]">
        Main manifest sync
      </span>
      {select}
      <span className="text-[11.5px] text-[#6b7a70]">
        Only Super Admins see this setting.
      </span>
      {result ? (
        <span
          role={result.ok ? "status" : "alert"}
          data-sync-result
          className={
            result.ok
              ? "text-[12.5px] font-bold text-[#15803d]"
              : "text-[12.5px] font-semibold text-[#b91c1c]"
          }
        >
          {result.text}
        </span>
      ) : null}
    </span>
  );

  return {
    control: (
      <>
        <span className="ml-auto max-sm:hidden">{inner}</span>
        <PhoneMore className="ml-auto sm:hidden" label="Main manifest sync">
          {inner}
        </PhoneMore>
      </>
    ),
    below: (
      <>
        <p
          data-sync-help
          className="-mt-2 mb-3 text-right text-[12px] text-[#55645a] max-sm:hidden"
        >
          {SYNC_HELP[mode]}
        </p>
        {asking ? (
          <div
            data-sync-confirm
            className="mb-3 rounded-[10px] border border-[#fbbf24] bg-[#fffbeb] px-3 py-2.5 text-[13px] text-[#1f2d25]"
          >
            Staff will start seeing grey rows (orders not sent yet) and the
            Order Status column on this page. Turn on for staff?
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setAsking(false)}
                className="cursor-pointer rounded-[9px] border border-[#c9d3cc] bg-white px-3.5 py-1 text-[13px] text-[#1f2d25]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save("staff")}
                className="cursor-pointer rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-1 text-[13px] font-bold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Turn on for staff"}
              </button>
            </div>
          </div>
        ) : null}
      </>
    ),
  };
}
