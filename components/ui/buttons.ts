// night: = 全深色主题（lib/theme.ts），平时不生效。
export const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60 night:border night:border-white/20 night:bg-white/[.12] night:hover:bg-white/[.18]";

export const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-stone-300 bg-paper px-4 py-2 text-sm font-medium text-[#1a1a1a] hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 night:border-white/10 night:bg-white/[.04] night:text-white night:hover:bg-white/[.08]";

export const DANGER_BUTTON_CLASS =
  "rounded-md bg-[#A32D2D] px-4 py-2 text-sm font-medium text-white hover:bg-[#8A2424] disabled:cursor-not-allowed disabled:opacity-60";

// 深色页面用（照旧后台 base.html 的 .btn / .btn-blue）。DANGER_BUTTON_CLASS 是纯色实心按钮，
// 深浅底都一样显眼，深色页面不用另开一份。

export const DARK_PRIMARY_BUTTON_CLASS =
  "rounded-md border border-[#3b82f6] bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 添加键：点了只是先加在页面上、还要再按 Save 才存的 Add，一律灰绿 #6b8e74、白字
 * （Annie 2026-10-30「把add 弄成A 灰绿」；直接存的 Add / Create 照旧蓝色，见 CLAUDE.md）。
 */
export const DARK_ADD_BUTTON_CLASS =
  "rounded-md border border-[#6b8e74] bg-[#6b8e74] px-4 py-2 text-sm font-medium text-white hover:bg-[#5d7d66] disabled:cursor-not-allowed disabled:opacity-60";

export const DARK_SECONDARY_BUTTON_CLASS =
  "rounded-md border border-white/10 bg-white/[.04] px-4 py-2 text-sm font-medium text-white hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-60";
