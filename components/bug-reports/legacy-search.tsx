import { cn } from "@/lib/utils";

import { TOOLBAR_INPUT_CLASS } from "./legacy-styles";

/**
 * 旧页面筛选条里的搜索框（普通输入框，没有 🔍）。
 * 保留 ops 原来的两个小功能：有内容时右边的 ✕ 清空、按 Esc 清空。
 */
export function LegacySearch({
  value,
  onChange,
  placeholder,
  label,
  widthClass,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** 读屏用的名字。 */
  label: string;
  /** 旧页面的宽度：Bug Reports 220px，Task Board 240px。 */
  widthClass: string;
}) {
  return (
    <span className={cn("relative inline-flex", widthClass)}>
      <input
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
        className={cn(TOOLBAR_INPUT_CLASS, "w-full", value && "pr-6")}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-[11px] text-[#94a3b8] hover:text-[#0f172a]"
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}
