"use client";

import { cn } from "@/lib/utils";

export interface UnitSaveState {
  /** 这个单元和已存的不一样。 */
  dirty: boolean;
  /** 正在存（只锁这个单元）。 */
  saving: boolean;
  /** 服务端 / 前端挡下来的原因（原文）。 */
  error: string | null;
  /** 页面整体不能改（别人在改 / 加载中），键也点不了。 */
  disabled: boolean;
  onSave: () => void;
}

/**
 * 单元标题行右边的保存区（Annie 2026-10-18 看过预览说「动手」）：
 * 没改 = 灰键 + Saved；改了没存 = 蓝键 + Unsaved changes；存的时候 = 灰键 + Saving…。
 * 蓝色只给提交键，所以 Save 是蓝的。
 */
export function UnitSave({
  unit,
  s,
  tone = "light",
}: {
  unit: string;
  s: UnitSaveState;
  tone?: "light" | "dark";
}) {
  const label = s.saving ? "Saving…" : s.dirty ? "Unsaved changes" : "Saved";
  const on = s.dirty && !s.saving && !s.disabled;
  return (
    <span data-unit-save={unit} className="flex items-center gap-2.5">
      <span
        role="status"
        data-unit-state={s.saving ? "saving" : s.dirty ? "dirty" : "saved"}
        className={cn(
          "text-[12px] font-semibold",
          s.saving || s.dirty
            ? tone === "dark"
              ? "text-[#fde68a]"
              : "text-[#8a5a00]"
            : tone === "dark"
              ? "text-[#86efac]"
              : "text-[#157347]",
        )}
      >
        {label}
      </span>
      <button
        type="button"
        data-unit-save-btn={unit}
        disabled={!on}
        onClick={s.onSave}
        className={cn(
          "h-8 rounded-lg px-4 text-[13px] font-semibold",
          on
            ? "cursor-pointer bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
            : "cursor-not-allowed bg-[#e9e9e6] text-[#6b7280]",
        )}
      >
        Save
      </button>
    </span>
  );
}

/** 这个单元被挡下来的原因：写在单元标题下面，红底（同预览第 4 种）。 */
export function UnitError({
  unit,
  text,
  tone = "light",
}: {
  unit: string;
  text: string | null;
  tone?: "light" | "dark";
}) {
  if (!text) return null;
  return (
    <p
      role="alert"
      data-unit-error={unit}
      className={cn(
        "m-0 border-b px-5 py-[9px] text-[12.5px] font-semibold",
        tone === "dark"
          ? "rounded-lg border-[rgba(248,113,113,.4)] bg-[rgba(248,113,113,.12)] text-[#fecaca]"
          : "border-[#f5c6c2] bg-[#fdecea] text-[#b3261e]",
      )}
    >
      {text}
    </p>
  );
}
