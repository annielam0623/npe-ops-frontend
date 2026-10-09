/**
 * 照旧后台 templates/admin/vehicles.html 的样式（Annie 2026-10-07：页面对着旧版做到一模一样）。
 * 旧页面是深色外框（base.html）里放**白色卡片**：卡片里的文字颜色一律显式写，不写就是白底白字。
 * 类名后面注释的是旧模板里对应的 CSS 类。
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

/** .result-msg .ok / .fail */
export const RESULT_OK_CLASS = "text-[#3B6D11]";
export const RESULT_FAIL_CLASS = "text-[#A32D2D]";

/** .muted */
export const MUTED_CLASS = "text-[#999]";
