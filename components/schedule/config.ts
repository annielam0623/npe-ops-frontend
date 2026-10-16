/** 深色底上的面板，同 Dispatch 的新功能（旧后台没有对应页面时照旧后台深色风格，CLAUDE.md）。 */
export const CARD = "rounded-[14px] border border-white/10 bg-white/[.04]";
export const CARD_HEADER =
  "flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3";
export const MUTED = "text-white/55";
export const DIM = "text-white/35";

export const PRIMARY_BTN =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-[7px] text-[13px] font-semibold text-white transition hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/40";
export const SECONDARY_BTN =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-white/10 bg-white/[.04] px-3.5 py-[7px] text-[13px] font-semibold text-white transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-40";
export const ICON_BTN =
  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border border-white/10 bg-white/[.04] text-white/80 transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-30";

export const INPUT =
  "rounded-[7px] border border-white/10 bg-white/[.04] px-2.5 py-[6px] text-[13px] text-white/90 focus:border-sky-400/60 focus:outline-none";

/** 班次 key 没配到颜色时的兜底。 */
const FALLBACK_SHIFT_COLOR = "bg-white/10 text-white/70";

/** 常见班次 key 的颜色；没匹配到走兜底（种子数据以外新加的班次类型一样能用，只是没专属颜色）。 */
const SHIFT_COLORS: Record<string, string> = {
  open: "bg-emerald-400/15 text-emerald-300",
  mid: "bg-sky-400/15 text-sky-300",
  close: "bg-purple-400/15 text-purple-300",
  off: "bg-white/[.06] text-white/40",
};

export function shiftColorClass(key: string | null): string {
  if (!key) return FALLBACK_SHIFT_COLOR;
  return SHIFT_COLORS[key] ?? FALLBACK_SHIFT_COLOR;
}

export const DAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
