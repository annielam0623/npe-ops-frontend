import type { ReactNode } from "react";

/**
 * 页面底部的「📖 How to use」，默认收起（同旧后台，Annie 2026-10-03「看一次、实操一下就会用了」）。
 * 文案照旧页面，按 ops 的实际行为改写；页面行为一改，这里同一次提交跟着改。
 */
export function HowToUse({
  title,
  items,
  warning,
}: {
  title: string;
  items: ReactNode[];
  warning?: ReactNode;
}) {
  return (
    <details className="max-w-3xl rounded-lg border border-[#d4e6c3] bg-[#f7f9f5] px-5 py-4 text-sm leading-relaxed text-[#4a5a3a]">
      <summary className="cursor-pointer font-semibold text-[#3B6D11]">
        📖 {title}
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
      {warning ? (
        <p className="mt-3 border-t border-[#d4e6c3] pt-3">⚠️ {warning}</p>
      ) : null}
    </details>
  );
}
