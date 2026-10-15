import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 旧后台 send_log.html 的样子（Annie 2026-10-07：和旧版一模一样）。数值照旧模板 extra_styles 抄。
 */

/** .filter-bar */
export const FILTER_BAR =
  "flex flex-wrap items-center gap-2.5 rounded-[10px] border-[0.5px] border-black/10 night:border-white/10 bg-paper night:bg-white/[.04] px-4 py-3";

/** .btn-reset */
export const BTN_RESET =
  "inline-flex cursor-pointer items-center rounded-[7px] border-[0.5px] border-black/15 night:border-white/10 bg-paper night:bg-white/[.04] px-3.5 py-[7px] text-[12px] whitespace-nowrap text-[#1a1a1a] night:text-white/55 disabled:cursor-not-allowed disabled:opacity-60";

/** .btn-export（Order Log） */
export const BTN_EXPORT =
  "inline-flex cursor-pointer items-center rounded-[7px] border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-3.5 py-[7px] text-[12px] whitespace-nowrap text-[#1a1a1a] night:text-white/75 hover:bg-[#f5f5f3] night:hover:bg-white/[.03] disabled:cursor-not-allowed disabled:opacity-60";

/** .records-count */
export const RECORDS_COUNT =
  "ml-auto text-[12px] whitespace-nowrap text-[#1a1a1a] night:text-white/35 tabular-nums";

/** .table-card */
export const TABLE_CARD =
  "overflow-hidden rounded-xl border-[0.5px] border-black/10 night:border-white/10 bg-paper night:bg-white/[.04]";

/** .table-header */
export const TABLE_HEADER =
  "flex items-center justify-between border-b-[0.5px] border-black/[.08] night:border-white/10 bg-paper night:bg-white/[.03] px-4 py-2.5";

/** .table-header span */
export const TABLE_TITLE =
  "text-[13px] font-semibold text-[#1a1a1a] night:text-white/90";

/** .page-btn */
export const PAGE_BTN =
  "cursor-pointer rounded-md border-[0.5px] border-black/15 night:border-white/10 bg-paper night:bg-white/[.04] px-2.5 py-1 text-[12px] text-[#1a1a1a] night:text-white/75 hover:bg-[#f5f5f3] night:hover:bg-white/[.03] disabled:cursor-not-allowed disabled:opacity-50";

/** .filter-bar select */
const SELECT_CLASS =
  "rounded-[7px] border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-2.5 py-1.5 font-[inherit] text-[13px] text-[#1a1a1a] night:text-white/90 focus:border-[#1a1a1a] night:focus:border-white/40 focus:outline-none disabled:opacity-50";

/** 旧页面筛选条里的「Module [All ▾]」：名字在框外左边。 */
export function LegacySelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex items-center">
      <span className="mr-1 text-[12px] text-[#1a1a1a] night:text-white/55">
        {label}
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {children}
      </select>
    </label>
  );
}

/** 旧页面筛选条里的文字框（.filter-bar input[type=text]），带 ✕ 清空；Esc 也清空。 */
export function LegacySearch({
  id,
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[7px] border-[0.5px] border-black/20 bg-paper px-2.5 py-1.5 text-[13px] focus-within:border-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:focus-within:border-white/40",
        className,
      )}
    >
      <input
        id={id}
        type="text"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) onChange("");
        }}
        className="min-w-0 flex-1 bg-transparent font-[inherit] text-[13px] text-[#1a1a1a] placeholder:text-[#aaa] focus:outline-none night:text-white/90 night:placeholder:text-white/35"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="text-[11px] text-[#1a1a1a] hover:text-[#444] night:text-white/35 night:hover:text-white/75"
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}
