"use client";

import { cn } from "@/lib/utils";
import { useViewOnly } from "@/components/ui/view-only";

export interface UnitSaveState {
  /** 这个单元和已存的不一样。 */
  dirty: boolean;
  /** 正在存（只锁这个单元）。 */
  saving: boolean;
  /** 服务端 / 前端挡下来的原因（原文）。 */
  error: string | null;
  /** 页面整体不能改（别人在改 / 加载中），键也点不了。 */
  disabled: boolean;
  /** 这次打开以来存好过：auto = 10 分钟没活动自动存的；at = 洛杉矶时间「3:42 PM」。再改就不显示（看 dirty）。 */
  saved: { auto: boolean; at: string } | null;
  onSave: () => void;
}

/** 存好以后的那句话：手动「Saved」，自动「Auto-saved 3:42 PM」（Annie 2026-10-29）。 */
function savedLabel(s: UnitSaveState): string {
  return s.saved?.auto ? `Auto-saved ${s.saved.at}` : "Saved";
}

/**
 * 团块标题行右边的保存状态（Annie 2026-10-29「动手」preview Q2：原来的 Save 键去掉，只留状态字；
 * 存在每台车 Edit 旁边的 Save）。
 */
export function UnitStatus({
  unit,
  s,
  tone = "light",
}: {
  unit: string;
  s: UnitSaveState;
  tone?: "light" | "dark";
}) {
  const viewOnly = useViewOnly();
  if (viewOnly) return null;
  const label = s.saving
    ? "Saving…"
    : s.dirty
      ? "Unsaved changes"
      : s.saved
        ? savedLabel(s)
        : "Saved";
  return (
    <span data-unit-save={unit}>
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
    </span>
  );
}

/**
 * 每台车 Edit ▼ 旁边的 Save（Annie 2026-10-29「动手」，preview 18d91JAUbvdy87Bd1idDA5）：
 * 存的是这台车所在的整个单元（后端按单元整块存，Q1），同一单元的 Save 一起变蓝 / 一起变 Saved。
 * 没改 = 灰；改了 = 蓝（提交键）；存的时候灰 + Saving…；存好 = ✓ Saved 一直留到再改（Q3）；存不上 = 红字 Not saved，原因在单元标题下面。
 */
export function RowSave({
  s,
  stack = false,
}: {
  s: UnitSaveState;
  /** 窄的一列（Morning Relay 的 Actions 列）：状态字放在键下面。 */
  stack?: boolean;
}) {
  const viewOnly = useViewOnly();
  if (viewOnly) return null;
  const on = s.dirty && !s.saving && !s.disabled;
  const status = s.saving
    ? { text: "Saving…", cls: "text-[#6b7280]" }
    : s.dirty
      ? s.error
        ? { text: "Not saved", cls: "text-[#b3261e]" }
        : null
      : s.saved
        ? { text: `✓ ${savedLabel(s)}`, cls: "text-[#157347]" }
        : null;
  return (
    <span
      className={cn(
        "flex gap-2",
        stack ? "flex-col items-end gap-1" : "items-center",
      )}
    >
      <button
        type="button"
        data-row-save
        disabled={!on}
        onClick={s.onSave}
        className={cn(
          "h-[34px] rounded-[7px] px-3.5 text-[13px] font-semibold",
          on
            ? "cursor-pointer bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
            : "cursor-not-allowed bg-[#e9e9e6] text-[#6b7280]",
        )}
      >
        Save
      </button>
      {status ? (
        <span
          data-row-save-state
          className={cn(
            "text-[12px] font-semibold whitespace-nowrap",
            status.cls,
          )}
        >
          {status.text}
        </span>
      ) : null}
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
