"use client";

import { cn } from "@/lib/utils";

import { type LockInfo, lockText } from "./config";

/**
 * G250 锁定的样子（置顶 93，Annie「93：全按推荐，动手」，preview SgRWaBvRcTie4cTdziPjtD Q1–Q5 全 A）：
 * 团名旁「🔒 Locked」普通字（员工灰、Super Admin 琥珀），标题下一条说明（员工灰底、Super Admin 浅黄），
 * 存不了（409）时说明条下面一个红框「Not saved: 」+ 后端原话。
 */
export function LockBadge({ l }: { l: LockInfo | null }) {
  if (!l) return null;
  return (
    <span
      data-lock-badge={l.canEdit ? "sa" : "staff"}
      className={cn(
        "text-[12.5px] font-semibold",
        l.canEdit ? "text-[#b45309]" : "text-[#4b5563]",
      )}
    >
      🔒 Locked
    </span>
  );
}

export function LockBar({
  l,
  className,
}: {
  l: LockInfo | null;
  className?: string;
}) {
  if (!l) return null;
  return (
    <div
      data-lock-bar={l.canEdit ? "sa" : "staff"}
      className={cn(
        "border-b px-5 py-2 text-[13px] font-semibold",
        l.canEdit
          ? "border-[#fcd34d] bg-[#fffbeb] text-[#92400e]"
          : "border-[#e5e7eb] bg-[#f3f4f6] text-[#374151]",
        className,
      )}
    >
      {lockText(l)}
    </div>
  );
}

export function LockError({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div
      role="alert"
      data-lock-error
      className="mx-5 mt-2.5 rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-[13px] font-semibold text-[#b91c1c]"
    >
      {text}
    </div>
  );
}

/** 标题行右边：存不了时代替「Saved」写红字「Not saved」（员工锁住后 UnitStatus 不显示）。 */
export function LockNotSaved() {
  return (
    <span
      role="status"
      data-unit-state="locked"
      className="text-[12px] font-semibold text-[#dc2626]"
    >
      Not saved
    </span>
  );
}
