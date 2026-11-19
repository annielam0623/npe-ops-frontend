"use client";

import { useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchPayrollAutoLock,
  savePayrollAutoLock,
} from "@/lib/guide-payroll-api";
import { usePageVisibility } from "@/lib/page-visibility";
import { cn } from "@/lib/utils";

import { C_BTN, C_BTN_SAVE, C_CONFIRM } from "./payroll-cards-shared";

/**
 * Locked dates 卡上的「Auto-lock」开关（Annie 2026-11-17「…20号23：59才需要锁上」「问题2是5号发，其他同意推荐，动手」）：
 * 开了 ⇒ 每月 20 号 23:59（LA）锁本月 1–15，5 号 23:59 锁上月 16–月底。新功能开关：默认关、只有 Super Admin 看得到能改；
 * 样子照 Tour Tracking 的 Main manifest sync（虚线框 + 下拉 + 「Only Super Admins see this setting.」），
 * 打开前黄框确认，关掉直接存；存好绿字 Saved，失败红字照后端原句。读不到（不是 Super Admin / 旧后端）⇒ 不出。
 */

const SELECT =
  "cursor-pointer rounded-lg border border-[#cbd2dc] bg-white px-2 py-[4px] font-[inherit] text-[12.5px] font-semibold text-[#1a1a1a] outline-none disabled:opacity-60";

/** 自动锁的行：后端合同（d8a4f4b5）created_by 固定 "system"、note "Auto lock"。 */
export function isAutoLock(createdBy: string | null | undefined): boolean {
  return (createdBy ?? "").trim().toLowerCase() === "system";
}

export function PayrollAutoLock({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const { isSuperAdmin, loaded } = usePageVisibility();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!loaded || !isSuperAdmin) return;
    const ac = new AbortController();
    fetchPayrollAutoLock(ac.signal)
      // 后端 can_edit 只有 Super Admin 是 true；false ⇒ 不出开关（新功能开关只给 Super Admin 看）。
      .then((s) => {
        if (s?.can_edit !== false) setEnabled(!!s?.enabled);
      })
      .catch(() => {
        // 403 / 404（旧后端）⇒ 不出开关。
      });
    return () => ac.abort();
  }, [loaded, isSuperAdmin]);

  async function save(next: boolean) {
    setSaving(true);
    setResult(null);
    try {
      const s = await savePayrollAutoLock(next);
      setEnabled(!!s?.enabled);
      setResult({ ok: true, text: "Saved" });
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setResult({ ok: false, text: describeError(e) });
    } finally {
      setSaving(false);
      setAsking(false);
    }
  }

  if (!isSuperAdmin || enabled === null) return null;

  return (
    <div className="px-4 pt-3 max-sm:px-3" data-auto-lock>
      <span className="inline-flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[#cbd2dc] bg-white px-2.5 py-1">
        <span className="text-[12.5px] font-bold text-[#1a1a1a]">
          Auto-lock
        </span>
        <select
          aria-label="Auto-lock"
          data-auto-lock-select
          value={asking ? "on" : enabled ? "on" : "off"}
          disabled={saving}
          onChange={(e) => {
            const next = e.target.value === "on";
            setResult(null);
            if (next === enabled) {
              setAsking(false);
              return;
            }
            if (next) setAsking(true);
            else void save(false);
          }}
          className={SELECT}
        >
          <option value="off">Off</option>
          <option value="on">On</option>
        </select>
        <span className="text-[11.5px] text-[#4b5563]">
          Only Super Admins see this setting.
        </span>
        {result ? (
          <span
            role={result.ok ? "status" : "alert"}
            data-auto-lock-result
            className={cn(
              "text-[12.5px]",
              result.ok
                ? "font-bold text-[#15803d]"
                : "font-semibold text-[#b91c1c]",
            )}
          >
            {result.text}
          </span>
        ) : null}
      </span>
      <p className="mt-1 text-[12px] text-[#4b5563]" data-auto-lock-help>
        {enabled
          ? "On: the 1st–15th lock on the 20th at 11:59 PM, and the 16th–end of month lock on the 5th of the next month at 11:59 PM (Los Angeles time)."
          : "Off: nothing locks by itself. Lock dates by hand below."}
      </p>
      {asking ? (
        <div className={cn(C_CONFIRM, "mx-0")} data-auto-lock-confirm>
          Turn on auto-lock? Every month the 1st–15th will lock on the 20th at
          11:59 PM, and the 16th–end of month on the 5th of the next month at
          11:59 PM (Los Angeles time). Until then you can still change pay.
          <button
            type="button"
            className={C_BTN_SAVE}
            disabled={saving}
            onClick={() => void save(true)}
          >
            {saving ? "Saving…" : "Turn on"}
          </button>
          <button
            type="button"
            className={C_BTN}
            disabled={saving}
            onClick={() => setAsking(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
