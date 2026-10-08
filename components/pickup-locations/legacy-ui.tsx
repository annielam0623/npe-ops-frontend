import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 旧后台 pickup_locations.html / vehicles.html 的 extra_styles 照抄成 Tailwind 类（Annie 2026-10-07：和旧版一模一样）。
 * 两个旧模板的 CSS 几乎一样（vehicles.html 文件头写明「版式照 Pickup Locations」），只有几个灰度不同，
 * 用到的地方各自传。白卡片里的字一律显式给颜色（外框是深色底）。
 */

/** .card */
export const CARD_CLASS =
  "mb-5 overflow-hidden rounded-[12px] border-[0.5px] border-black/10 bg-white";
/** .card-header */
export const CARD_HEADER_CLASS =
  "flex flex-wrap items-center justify-between gap-3 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-3";
/** .card-header span */
export const CARD_TITLE_CLASS = "text-[13px] font-semibold text-[#1a1a1a]";

/** .form-group input */
export const FORM_INPUT_CLASS =
  "min-w-0 rounded-[7px] border-[0.5px] border-black/20 bg-white px-2.5 py-[7px] text-[13px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none disabled:opacity-60";
const BTN_ADD_BASE =
  "cursor-pointer rounded-[7px] border-none bg-[#1a1a1a] font-semibold whitespace-nowrap text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-60";
/** .btn-add */
export const BTN_ADD_CLASS = cn(BTN_ADD_BASE, "h-9 px-5 text-[13px]");
/** 表格编辑行里的 Save（旧模板行内 style：11px、4px 12px、高 30px）。 */
export const BTN_ADD_SMALL_CLASS = cn(
  BTN_ADD_BASE,
  "h-[30px] px-3 py-1 text-[11px]",
);

const SMALL_BTN =
  "cursor-pointer rounded-[6px] border-[0.5px] px-2.5 py-[3px] text-[11px] disabled:cursor-not-allowed disabled:opacity-50";
/** .btn-edit */
export const BTN_EDIT_CLASS = cn(
  SMALL_BTN,
  "border-black/20 bg-white text-[#555] hover:bg-[#f5f5f3]",
);
/** .btn-delete */
export const BTN_DELETE_CLASS = cn(
  SMALL_BTN,
  "border-[#A32D2D] bg-white text-[#A32D2D] hover:bg-[#fff5f5]",
);
/** .btn-off：停用（琥珀） */
export const BTN_OFF_CLASS = cn(
  SMALL_BTN,
  "border-[#fed7aa] bg-[#fff4e5] text-[#c2410c] hover:bg-[#ffe9cc]",
);
/** .btn-on：恢复 / 保存（绿） */
export const BTN_ON_CLASS = cn(
  SMALL_BTN,
  "border-[#bbf7d0] bg-[#dcfce7] text-[#166534] hover:bg-[#caf7d8]",
);

/** .inline-input，不带宽度（cn 不做 Tailwind 合并，要别的宽度时用它）。 */
export const INLINE_INPUT_BASE =
  "rounded-[6px] border-[0.5px] border-black/30 bg-white px-2 py-1 text-[12px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none disabled:opacity-60";
/** .inline-input（width:100%） */
export const INLINE_INPUT_CLASS = cn(INLINE_INPUT_BASE, "w-full");

/** 卡片抬头里的搜索框（旧模板是行内 style）。 */
export const HEADER_SEARCH_CLASS =
  "w-[180px] rounded-[6px] border-[0.5px] border-black/20 bg-white px-2.5 py-1 text-[12px] text-[#1a1a1a] focus:outline-none";

/** table.*-tbl thead td（颜色各页不同：pickup #999，vehicles #888）。 */
export const TH_CLASS =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-3 py-2 text-left text-[11px] font-semibold";
/** tbody tr（悬停色 TR_HOVER 另加：出错的行底色不能被它盖掉）。 */
export const TR_CLASS = "border-b-[0.5px] border-black/[.06] last:border-b-0";
export const TR_HOVER = "hover:bg-[#fafaf8]";
/** tbody：td 默认字色 #444 写在 tbody 上，单元格自己的颜色才盖得过（cn 不做 Tailwind 合并）。 */
export const TBODY_CLASS = "text-[#444]";
/** tbody td */
export const TD_CLASS = "px-3 py-[9px] align-middle";

/** .result-msg + .ok / .fail */
export function resultClass(tone: "ok" | "error" | null | undefined): string {
  return cn(
    "text-[12px]",
    tone === "ok" ? "text-[#3B6D11]" : tone === "error" ? "text-[#A32D2D]" : "",
  );
}

/** .page-header：h2 + 右边的总数，直接压在深色底上。 */
export function LegacyPageHeader({
  title,
  count,
}: {
  title: string;
  count?: ReactNode;
}) {
  return (
    <div className="mb-[18px] flex items-center justify-between">
      <h2 className="text-[15px] font-semibold text-[#f8fafc]">{title}</h2>
      <span className="text-[12px] text-[#aaa]">{count}</span>
    </div>
  );
}

/** 顶部的蓝色「📖 How to use」（旧模板行内 style），默认收起。 */
export function LegacyHowTo({
  title,
  children,
  footer,
  padY = "py-3",
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** pickup_locations.html 是 10px，vehicles.html 是 12px。 */
  padY?: string;
}) {
  return (
    <details
      className={cn(
        "mb-5 rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 text-[12px] leading-[1.8] text-[#0c3a6b]",
        padY,
      )}
    >
      <summary className="cursor-pointer font-semibold text-[#185FA5]">
        📖 {title}
      </summary>
      <ol className="mt-1.5 list-decimal pl-[18px]">{children}</ol>
      {footer ? (
        <div className="mt-2 border-t border-[#b5d4f4] pt-2">{footer}</div>
      ) : null}
    </details>
  );
}

/** 可点开的 Action Log 卡片抬头（.card-header.log-toggle）。 */
export function LogToggle({
  open,
  onToggle,
  hideHintWhenOpen,
}: {
  open: boolean;
  onToggle: () => void;
  /** pickup_locations.html 展开后把「Click to expand」藏掉；vehicles.html 一直留着。 */
  hideHintWhenOpen?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        CARD_HEADER_CLASS,
        "w-full cursor-pointer text-left select-none",
      )}
    >
      <span className={CARD_TITLE_CLASS}>
        <span aria-hidden>{open ? "▾" : "▸"}</span> Action Log
      </span>
      <span className="text-[11px] font-normal text-[#999]">
        {open && hideHintWhenOpen ? "" : "Click to expand"}
      </span>
    </button>
  );
}
