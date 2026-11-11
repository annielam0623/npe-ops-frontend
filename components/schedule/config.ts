import { type ShiftColor, shiftColorOf } from "@/lib/schedule-shift-colors";

/** 深色底上的面板，同 Dispatch 的新功能（旧后台没有对应页面时照旧后台深色风格，CLAUDE.md）。 */
export const CARD = "rounded-[14px] border border-white/10 bg-white/[.04]";
export const CARD_HEADER =
  "flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3";
export const MUTED = "text-white/55";
export const DIM = "text-white/35";

export const ICON_BTN =
  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border border-white/10 bg-white/[.04] text-white/80 transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-30";

export const INPUT =
  "rounded-[7px] border border-white/10 bg-white/[.04] px-2.5 py-[6px] text-[13px] text-white/90 [color-scheme:dark] [&>option]:bg-[#0f1b2d] [&>option]:text-white focus:border-sky-400/60 focus:outline-none";

/** 班次颜色的字色 + 淡底（小标签用）；颜色按班次类型存的 color 取（lib/schedule-shift-colors.ts）。 */
const SHIFT_COLOR_CLASSES: Record<ShiftColor, string> = {
  open: "bg-emerald-400/15 text-emerald-300",
  mid: "bg-sky-400/15 text-sky-300",
  close: "bg-purple-400/15 text-purple-300",
  amber: "bg-amber-400/15 text-amber-300",
  rose: "bg-rose-400/15 text-rose-300",
  teal: "bg-teal-400/15 text-teal-300",
  orange: "bg-orange-400/15 text-orange-300",
  grey: "bg-white/10 text-white/70",
};

/** 员工在名单条 / 时段卡片里的圆点颜色，按 id 轮一圈固定颜色（同一个人到处都一个颜色，方便认）。 */
const PERSON_DOT_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#fb923c",
  "#34d399",
  "#f472b6",
  "#facc15",
  "#60a5fa",
  "#f87171",
];

export function personDotColor(employeeId: number): string {
  return PERSON_DOT_COLORS[employeeId % PERSON_DOT_COLORS.length];
}

/**
 * 排班表格子里整张卡片的颜色（边框 + 底 + 班名字色），8 种同 preview 9LFRCau1uBg5sQ5aPbdSZt。
 * 按班次类型存的 color 取；旧后端没有 color 时 open / mid / close 照原来，其余灰白（grey = 原来的兜底）。
 */
const SHIFT_CARDS: Record<ShiftColor, string> = {
  open: "border-emerald-400/40 bg-emerald-400/[.12] text-emerald-300",
  mid: "border-sky-400/40 bg-sky-400/[.12] text-sky-300",
  close: "border-purple-400/50 bg-purple-400/[.16] text-purple-200",
  amber: "border-amber-400/45 bg-amber-400/[.13] text-amber-300",
  rose: "border-rose-400/45 bg-rose-400/[.13] text-rose-300",
  teal: "border-teal-400/45 bg-teal-400/[.12] text-teal-300",
  orange: "border-orange-400/45 bg-orange-400/[.13] text-orange-300",
  grey: "border-white/25 bg-white/[.08] text-white",
};

export function shiftCardClass(key: string | null): string {
  return SHIFT_CARDS[shiftColorOf(key)];
}

export function shiftColorClass(key: string | null): string {
  return SHIFT_COLOR_CLASSES[shiftColorOf(key)];
}

/**
 * 休假在格子里的名字（后端值 pto / sick / personal）。
 * 置顶 117（Annie 2026-11-10「今晚就先放Leave，明天我们回公司做假期申请的时候再分类」）：先一律显示 Leave，
 * 新录的存成 pto（后端不传 kind 的默认值）；分类时改回 PTO / Sick / Personal。
 */
export const TIME_OFF_LABEL: Record<string, string> = {
  pto: "Leave",
  sick: "Leave",
  personal: "Leave",
};

export const DAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
