import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 页面底部的「📖 How to use」，默认收起（同旧后台，Annie 2026-10-03「看一次、实操一下就会用了」）。
 * 文案照旧页面，按 ops 的实际行为改写；页面行为一改，这里同一次提交跟着改。
 * 样子照旧页面的 <details>（Annie 2026-10-07：和旧版一模一样）：浅色页是浅绿框；
 * 三个 tracking 页是深色底，用 dark（旧模板取的是页面自己的色板 #1a2f4a / #7ab3e0 / #c8ddf0）。
 */
export function HowToUse({
  title,
  items,
  warning,
  dark,
}: {
  title: string;
  items: ReactNode[];
  warning?: ReactNode;
  dark?: boolean;
}) {
  return (
    <details
      className={cn(
        "mt-4 mb-8 max-w-[760px] rounded-[10px] border px-5 py-4 text-xs leading-[1.9]",
        dark
          ? "border-white/[.12] bg-[#1a2f4a] text-[#c8ddf0]"
          : "border-[#d4e6c3] bg-[#f7f9f5] text-[#4a5a3a]",
      )}
    >
      <summary
        className={cn(
          "cursor-pointer font-semibold",
          dark ? "text-[#7ab3e0]" : "text-[#3B6D11]",
        )}
      >
        📖 {title}
      </summary>
      <ol className="mt-2 list-decimal pl-[18px]">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
      {warning ? (
        <div
          className={cn(
            "mt-2.5 border-t pt-2.5",
            dark ? "border-white/[.12]" : "border-[#d4e6c3]",
          )}
        >
          ⚠️ {warning}
        </div>
      ) : null}
    </details>
  );
}
