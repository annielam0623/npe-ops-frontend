import { cn } from "@/lib/utils";

/**
 * 旧后台 settings_hr.html 的 extra_styles 照抄成 Tailwind 类（Annie 2026-10-07：和旧版一模一样）。
 * 卡片是白底，字色一律显式写（外框是深色底）。
 */

/** .card */
export const HR_CARD_CLASS =
  "mb-5 overflow-hidden rounded-[12px] border-[0.5px] border-black/10 bg-white text-[#1a1a1a]";
/** .card-header */
export const HR_CARD_HEADER_CLASS =
  "flex flex-wrap items-center justify-between gap-2.5 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-3";
/** .card-header span.ttl */
export const HR_CARD_TITLE_CLASS = "text-[13px] font-semibold text-[#1a1a1a]";

// cn 只拼字符串、不做 Tailwind 合并：颜色不能在两处都写，所以三种按钮各给一套颜色。
const HR_BTN_BASE =
  "cursor-pointer rounded-[7px] border-[0.5px] px-[13px] py-[7px] text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50";
/** .btn */
export const HR_BTN_CLASS = cn(
  HR_BTN_BASE,
  "border-black/20 bg-white text-[#1a1a1a] hover:bg-[#f4f4f2]",
);
/** .btn.btn-primary */
export const HR_BTN_PRIMARY_CLASS = cn(
  HR_BTN_BASE,
  "border-[#1a1a1a] bg-[#1a1a1a] text-white hover:bg-[#333]",
);
/** .btn.btn-danger */
export const HR_BTN_DANGER_CLASS = cn(
  HR_BTN_BASE,
  "border-[rgba(179,38,30,0.35)] bg-white text-[#b3261e] hover:bg-[#fdeceb]",
);

/** .pill */
export const HR_PILL_CLASS =
  "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap";

/** .empty */
export const HR_EMPTY_CLASS = "px-4 py-7 text-center text-[13px] text-[#888]";
