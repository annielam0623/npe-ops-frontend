/**
 * 旧后台 settings_teams.html / settings_users.html 弹窗里的样式（行内 style 照抄成 Tailwind）。
 * 共用的 Modal 默认 rounded-xl，旧页面是 14px，所以圆角用 ! 盖掉。
 */
export const LEGACY_MODAL_TITLE_CLASS =
  "m-0 mb-[22px] text-[18px] font-bold text-[#1a1a1a]";

export const LEGACY_LABEL_CLASS =
  "mb-1.5 block text-[13px] font-semibold text-[#444]";

export const LEGACY_INPUT_CLASS =
  "mb-4 box-border w-full rounded-[8px] border border-[#ddd] bg-white px-3.5 py-2.5 text-[14px] text-black";

export const LEGACY_ERROR_CLASS = "mb-3 text-[13px] text-[#c0392b]";

export const LEGACY_SAVE_BUTTON_CLASS =
  "cursor-pointer rounded-[8px] border-0 bg-[#1a3a5c] px-5 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60";

export const LEGACY_CANCEL_BUTTON_CLASS =
  "cursor-pointer rounded-[8px] border border-[#ddd] bg-[#f5f5f5] px-5 py-2.5 text-[14px] text-black disabled:cursor-not-allowed disabled:opacity-60";

/** 旧页面没有删除确认弹窗（用的 confirm()），确认键借用卡片上 Delete 的红色。 */
export const LEGACY_DELETE_BUTTON_CLASS =
  "cursor-pointer rounded-[8px] border border-[#ffc5c5] bg-[#fff5f5] px-5 py-2.5 text-[14px] font-semibold text-[#c0392b] disabled:cursor-not-allowed disabled:opacity-60";
