/**
 * 旧后台「深色外框里放白色卡片」那一类设置页的共用样式（vehicles.html、pickup_locations.html 等，
 * 两页的 CSS 是同一套；Annie 2026-10-07：页面对着旧版做到一模一样）。
 * 卡片里的文字颜色一律显式写，不写就是白底白字。注释里是旧模板对应的 CSS 类。
 */

/** .card */
export const CARD_CLASS =
  "overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white text-[#1a1a1a]";

/** .card-header（及其中的 span 标题） */
export const CARD_HEADER_CLASS =
  "flex flex-wrap items-center justify-between gap-3 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-3";
export const CARD_TITLE_CLASS = "text-[13px] font-semibold text-[#1a1a1a]";

/** .form-group input / .col-add input */
export const FORM_INPUT_CLASS =
  "rounded-[7px] border-[0.5px] border-black/20 bg-white px-2.5 py-[7px] font-[inherit] text-[13px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none disabled:opacity-60";

/** .inline-input */
export const INLINE_INPUT_CLASS =
  "w-full rounded-md border-[0.5px] border-black/30 bg-white px-2 py-1 font-[inherit] text-xs text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none disabled:opacity-60";

const SMALL_BUTTON =
  "cursor-pointer rounded-md border-[0.5px] px-2.5 py-[3px] text-[11px] whitespace-nowrap disabled:cursor-default disabled:opacity-50";
/** .btn-edit */
export const BTN_EDIT_CLASS = `${SMALL_BUTTON} border-black/20 bg-white text-[#555] hover:bg-[#f5f5f3]`;
/** .btn-off（停用 / 隐藏，琥珀） */
export const BTN_OFF_CLASS = `${SMALL_BUTTON} border-[#fed7aa] bg-[#fff4e5] text-[#c2410c] hover:bg-[#ffe9cc]`;
/** .btn-on（保存 / 恢复 / 显示，绿） */
export const BTN_ON_CLASS = `${SMALL_BUTTON} border-[#bbf7d0] bg-[#dcfce7] text-[#166534] hover:bg-[#caf7d8]`;

/** .btn-delete（删掉就没了，红；停用用琥珀，别混） */
export const BTN_DELETE_CLASS = `${SMALL_BUTTON} border-[#A32D2D] bg-white text-[#A32D2D] hover:bg-[#fff5f5]`;

/** .btn-add（卡片里的主按钮，黑） */
export const BTN_ADD_CLASS =
  "h-9 cursor-pointer rounded-[7px] bg-[#1a1a1a] px-5 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-[#333] disabled:cursor-default disabled:opacity-50";

/** 卡片抬头里的搜索框（旧模板写在 style 属性里） */
export const CARD_SEARCH_CLASS =
  "w-[180px] rounded-md border-[0.5px] border-black/20 bg-white px-2.5 py-1 text-xs text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none";

/** 表头那一行（thead td） */
export const THEAD_ROW_CLASS =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] text-left text-[11px] font-semibold";

/** 表身一行（tbody tr） */
export const TBODY_ROW_CLASS =
  "border-b-[0.5px] border-black/[.06] text-[#444] last:border-b-0 hover:bg-[#fafaf8]";

/** .result-msg .ok / .fail */
export const RESULT_OK_CLASS = "text-[#3B6D11]";
export const RESULT_FAIL_CLASS = "text-[#A32D2D]";

/** .muted */
export const MUTED_CLASS = "text-[#999]";
