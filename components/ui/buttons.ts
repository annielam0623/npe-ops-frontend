export const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60";

export const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60";

export const DANGER_BUTTON_CLASS =
  "rounded-md bg-[#A32D2D] px-4 py-2 text-sm font-medium text-white hover:bg-[#8A2424] disabled:cursor-not-allowed disabled:opacity-60";

// 深色页面用（照旧后台 base.html 的 .btn / .btn-blue）。DANGER_BUTTON_CLASS 是纯色实心按钮，
// 深浅底都一样显眼，深色页面不用另开一份。

export const DARK_PRIMARY_BUTTON_CLASS =
  "rounded-md border border-[#3b82f6] bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";

export const DARK_SECONDARY_BUTTON_CLASS =
  "rounded-md border border-white/10 bg-white/[.04] px-4 py-2 text-sm font-medium text-white hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-60";
