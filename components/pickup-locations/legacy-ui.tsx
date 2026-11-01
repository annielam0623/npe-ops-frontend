import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 旧后台 pickup_locations.html / vehicles.html 的 extra_styles 照抄成 Tailwind 类（Annie 2026-10-07：和旧版一模一样）。
 * 两个旧模板的 CSS 几乎一样（vehicles.html 文件头写明「版式照 Pickup Locations」），只有几个灰度不同，
 * 用到的地方各自传。白卡片里的字一律显式给颜色（外框是深色底）。
 */

/** .card */
export const CARD_CLASS =
  "mb-5 overflow-hidden rounded-[12px] border-[0.5px] border-black/10 night:border-white/10 bg-paper night:bg-white/[.04]";
/** .card-header */
export const CARD_HEADER_CLASS =
  "flex flex-wrap items-center justify-between gap-3 border-b-[0.5px] border-black/[.08] night:border-white/10 bg-paper night:bg-white/[.03] px-4 py-3";
/** .card-header span */
export const CARD_TITLE_CLASS =
  "text-[13px] font-semibold text-[#1a1a1a] night:text-white/90";

/** .form-group input */
export const FORM_INPUT_CLASS =
  "min-w-0 rounded-[7px] border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-2.5 py-[7px] text-[13px] text-[#1a1a1a] night:text-white/90 focus:border-[#1a1a1a] night:focus:border-white/40 focus:outline-none disabled:opacity-60";
const BTN_ADD_BASE =
  "cursor-pointer rounded-[7px] border-none bg-[#1a1a1a] font-semibold whitespace-nowrap text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-60";
/** .btn-add */
export const BTN_ADD_CLASS = cn(BTN_ADD_BASE, "h-9 px-5 text-[13px]");
/** 直接存进系统的 Add（Pickup / Vehicles / Farm out 新增那一行）：蓝色提交键（Annie 2026-10-30，见 CLAUDE.md）。 */
export const BTN_SUBMIT_CLASS =
  "h-9 cursor-pointer rounded-[7px] border-none bg-[#3b82f6] text-white hover:bg-[#2f76e8] px-5 text-[13px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";
/** 先加在页面上、还要按 Save 的小号添加键（+ Add location / + Add time / + Add season）：灰绿。 */
export const BTN_ADD_GREEN_SMALL_CLASS =
  "cursor-pointer rounded-[6px] border-[0.5px] border-[#6b8e74] bg-[#6b8e74] text-white hover:bg-[#5d7d66] px-2.5 py-[3px] text-[11px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";
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
  "border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] text-[#1a1a1a] night:text-white/75 hover:bg-[#f5f5f3] night:hover:bg-white/[.03]",
);
/** .btn-delete */
export const BTN_DELETE_CLASS = cn(
  SMALL_BTN,
  "border-[#A32D2D] night:border-red-400/50 bg-paper night:bg-white/[.04] text-[#A32D2D] night:text-red-300 hover:bg-[#fff5f5] night:hover:bg-red-500/10",
);
/** .btn-off：停用（琥珀） */
export const BTN_OFF_CLASS = cn(
  SMALL_BTN,
  "border-[#fed7aa] night:border-amber-400/30 bg-[#fff4e5] night:bg-amber-400/10 text-[#c2410c] night:text-amber-200 hover:bg-[#ffe9cc] night:hover:bg-amber-400/10",
);
/** .btn-on：恢复 / 保存（绿） */
export const BTN_ON_CLASS = cn(
  SMALL_BTN,
  "border-[#bbf7d0] night:border-emerald-400/30 bg-[#dcfce7] night:bg-emerald-400/10 text-[#166534] night:text-emerald-300 hover:bg-[#caf7d8] night:hover:bg-emerald-400/10",
);

/** .inline-input，不带宽度（cn 不做 Tailwind 合并，要别的宽度时用它）。 */
export const INLINE_INPUT_BASE =
  "rounded-[6px] border-[0.5px] border-black/30 night:border-white/10 bg-paper night:bg-white/[.04] px-2 py-1 text-[12px] text-[#1a1a1a] night:text-white/90 focus:border-[#1a1a1a] night:focus:border-white/40 focus:outline-none disabled:opacity-60";
/** .inline-input（width:100%） */
export const INLINE_INPUT_CLASS = cn(INLINE_INPUT_BASE, "w-full");

/** 卡片抬头里的搜索框（旧模板是行内 style）。 */
export const HEADER_SEARCH_CLASS =
  "w-[180px] rounded-[6px] border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-2.5 py-1 text-[12px] text-[#1a1a1a] night:text-white/90 focus:outline-none";

/** table.*-tbl thead td（旧模板表头灰字；Annie 2026-10-14：白底上的灰字一律改 #1a1a1a、表头底改白）。 */
export const TH_CLASS =
  "border-b-[0.5px] border-black/[.08] night:border-white/10 bg-paper night:bg-white/[.03] px-3 py-2 text-left text-[11px] font-semibold";
/** tbody tr（悬停色 TR_HOVER 另加：出错的行底色不能被它盖掉）。 */
export const TR_CLASS =
  "border-b-[0.5px] border-black/[.06] night:border-white/10 last:border-b-0";
export const TR_HOVER = "hover:bg-[#fafaf8] night:hover:bg-white/[.03]";
/** tbody：td 默认字色（旧模板 #444，2026-10-14 改 #1a1a1a）写在 tbody 上，单元格自己的颜色才盖得过（cn 不做 Tailwind 合并）。 */
export const TBODY_CLASS = "text-[#1a1a1a] night:text-white/75";
/** tbody td */
export const TD_CLASS = "px-3 py-[9px] align-middle";

/** 卡片抬头里的导出键（同 Broadcasting Log / Send Log 的 ⬇ Export，白卡片用这个样子）。 */
export const BTN_EXPORT =
  "cursor-pointer rounded-[7px] border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-3.5 py-1.5 text-[12px] text-[#1a1a1a] night:text-white/75 hover:bg-[#f5f5f3] night:hover:bg-white/[.03] disabled:cursor-not-allowed disabled:opacity-60";

/** .result-msg + .ok / .fail */
export function resultClass(tone: "ok" | "error" | null | undefined): string {
  return cn(
    "text-[12px]",
    tone === "ok"
      ? "text-[#3B6D11] night:text-emerald-300"
      : tone === "error"
        ? "text-[#A32D2D] night:text-red-300"
        : "",
  );
}

/**
 * .page-header：右边的总数，直接压在深色底上。标题文字和顶栏重复，只留给读屏（Annie 2026-10-19：保留最上面那个，页内重复的去掉）；
 * 没有总数时整行不占位。
 */
export function LegacyPageHeader({
  title,
  count,
}: {
  title: string;
  count?: ReactNode;
}) {
  return (
    <div
      className={count ? "mb-[18px] flex items-center justify-end" : undefined}
    >
      <h2 className="sr-only">{title}</h2>
      {count ? (
        <span className="text-[12px] text-[#aaa] night:text-white/35">
          {count}
        </span>
      ) : null}
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
        "mb-5 rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 text-[12px] leading-[1.8] text-[#0c3a6b] night:border-sky-400/20 night:bg-sky-400/[.08] night:text-sky-300",
        padY,
      )}
    >
      <summary className="cursor-pointer font-semibold text-[#185FA5] night:text-sky-300">
        📖 {title}
      </summary>
      <ol className="mt-1.5 list-decimal pl-[18px]">{children}</ol>
      {footer ? (
        <div className="mt-2 border-t border-[#b5d4f4] pt-2 night:border-sky-400/20">
          {footer}
        </div>
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
      <span className="text-[11px] font-normal text-[#1a1a1a] night:text-white/35">
        {open && hideHintWhenOpen ? "" : "Click to expand"}
      </span>
    </button>
  );
}
