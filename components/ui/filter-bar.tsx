"use client";

import type { ChangeEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 列表页顶部筛选条的紧凑样式（Annie 2026-10-05 定：按钮太大，全站换成小一号）。
 * 所有控件统一 26px 高、12px 字；下拉框的名字写在框里，整条尽量一行放下。
 * night: = 全深色主题（lib/theme.ts），平时不生效。
 */

/** 输入框类控件在全深色下的样子（输入框、下拉框、搜索框共用）。 */
const NIGHT_FIELD =
  "night:border-white/15 night:bg-white/[.06] night:text-white night:placeholder:text-white/30 night:[color-scheme:dark]";

/** 筛选条外框：白底一行，放不下就换行。 */
export const FILTER_BAR_CLASS =
  "flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-stone-200 bg-paper px-3 py-2.5 night:border-white/10 night:bg-white/[.032]";

/** 26px 高的输入框 / 日期框（外面没有 FilterField 包着时用）。 */
export const FILTER_INPUT_CLASS = `h-[26px] rounded-md border border-stone-300 bg-paper px-2 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:opacity-50 ${NIGHT_FIELD}`;

/** Reset / Export 这类次要操作：不带边框的灰字按钮，移上去才有底色。 */
export const FILTER_TEXT_BUTTON_CLASS =
  "inline-flex h-[26px] items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap text-[#1a1a1a] hover:bg-stone-100 hover:text-black disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent night:text-white/60 night:hover:bg-white/[.08] night:hover:text-white";

/** 筛选条里需要强调的操作（Apply、Pull 等）：深色小按钮。 */
export const FILTER_PRIMARY_BUTTON_CLASS =
  "inline-flex h-[26px] items-center rounded-md bg-stone-800 px-3 text-xs font-medium whitespace-nowrap text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60 night:border night:border-white/20 night:bg-white/[.12] night:hover:bg-white/[.18]";

/** 带边框的 26px 小按钮（非文字按钮的次要操作）。 */
export const FILTER_BUTTON_CLASS =
  "inline-flex h-[26px] items-center gap-1 rounded-md border border-stone-300 bg-paper px-2.5 text-xs font-medium whitespace-nowrap text-[#1a1a1a] hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 night:border-white/10 night:bg-white/[.04] night:text-white night:hover:bg-white/[.08]";

/** 筛选条右端的记录数。 */
export const FILTER_COUNT_CLASS =
  "ml-auto text-xs whitespace-nowrap text-[#1a1a1a] tabular-nums night:text-white/50";

/** 一组连在一起的切换按钮（日期预设、Orders / Pax 等）。 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
  wrap,
}: {
  options: readonly { value: T; label: ReactNode; title?: string }[];
  /** 当前选中的值；null = 都不亮。 */
  value: T | null;
  onChange: (value: T) => void;
  /** 读屏用的组名。 */
  label: string;
  /** 整组变灰（例如订单搜索时日期不起作用）。仍可点，点了由外面决定怎么处理。 */
  disabled?: boolean;
  /** 选项多（例如 Bug 状态）：各自一个小块、放不下就换行，不连成一条。 */
  wrap?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        wrap
          ? "flex flex-wrap gap-1"
          : "inline-flex overflow-hidden rounded-md border border-stone-300 bg-paper night:border-white/15 night:bg-white/[.04]",
        disabled && "opacity-45",
      )}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 px-2.5 text-xs whitespace-nowrap",
            wrap
              ? "rounded-md border border-stone-300 night:border-white/15"
              : i > 0 && "border-l border-stone-200 night:border-white/10",
            value === o.value
              ? "border-stone-800 bg-stone-800 font-medium text-white night:border-white/60 night:bg-white/[.16]"
              : "bg-paper text-[#1a1a1a] hover:bg-stone-50 night:bg-transparent night:text-white/70 night:hover:bg-white/[.08]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 下拉框：名字写在框里（「Event All ▾」），不再单独占一行。 */
export function FilterSelect({
  label,
  value,
  onChange,
  children,
  disabled,
  dimmed,
  title,
}: {
  label: string;
  value: string;
  onChange: (value: string, event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  disabled?: boolean;
  /** 变灰但仍可选（例如订单搜索时日期不起作用，选了由外面清掉搜索）。 */
  dimmed?: boolean;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={cn(
        "inline-flex h-[26px] items-center gap-1 rounded-md border border-stone-300 bg-paper pl-2 text-xs focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-500",
        NIGHT_FIELD,
        disabled && "opacity-50",
        dimmed && "opacity-45",
      )}
    >
      <span className="text-[#1a1a1a] night:text-white/45">{label}</span>
      <select
        // 外面 label 里还有选中项的字，读屏 / 检查脚本按名字找时只认这个名字。
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value, e)}
        className="h-full cursor-pointer rounded-md bg-transparent pr-1 text-xs text-stone-800 focus:outline-none disabled:cursor-not-allowed night:text-white"
      >
        {children}
      </select>
    </label>
  );
}

/** 搜索框：🔍 + 输入 + 有内容时的 ✕。 */
export function FilterSearch({
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
  /** 读屏用的名字。 */
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] min-w-[200px] items-center gap-1.5 rounded-md border border-stone-300 bg-paper px-2 text-xs focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-500",
        NIGHT_FIELD,
        className,
      )}
    >
      <span
        aria-hidden
        className="text-[11px] text-[#1a1a1a] night:text-white/40"
      >
        🔍
      </span>
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
        className="h-full min-w-0 flex-1 bg-transparent text-xs text-stone-800 placeholder:text-stone-400 focus:outline-none night:text-white night:placeholder:text-white/30"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="text-[#1a1a1a] hover:text-black night:text-white/40 night:hover:text-white"
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}

/** 筛选条里分隔两组控件的细竖线。 */
export function FilterDivider() {
  return (
    <span aria-hidden className="h-4 w-px bg-stone-200 night:bg-white/15" />
  );
}
