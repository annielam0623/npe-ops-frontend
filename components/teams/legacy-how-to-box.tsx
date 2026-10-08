import type { ReactNode } from "react";

/**
 * 旧后台 Teams / Users 页顶部的「📖 How to use」蓝框（常开），样式照 settings_teams.html / settings_users.html：
 * #e8f3fc 底、#b5d4f4 边、10px 圆角、14px 20px 内边距、12px 字、行高 1.8；不用粗体（标题 600）。
 */
export function LegacyHowToBox({
  title,
  items,
  footer,
}: {
  title: string;
  items: ReactNode[];
  footer: ReactNode;
}) {
  return (
    <div className="mb-5 rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3.5 text-[12px] leading-[1.8] text-[#0c3a6b]">
      <div className="mb-1.5 font-semibold text-[#185FA5]">{title}</div>
      <ol className="m-0 list-decimal pl-[18px]">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
      <div className="mt-2 border-t border-[#b5d4f4] pt-2">{footer}</div>
    </div>
  );
}
