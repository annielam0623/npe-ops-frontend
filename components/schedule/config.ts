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

/** 班次 key 没配到颜色时的兜底。 */
const FALLBACK_SHIFT_COLOR = "bg-white/10 text-white/70";

/** 常见班次 key 的颜色；没匹配到走兜底（种子数据以外新加的班次类型一样能用，只是没专属颜色）。 */
const SHIFT_COLORS: Record<string, string> = {
  open: "bg-emerald-400/15 text-emerald-300",
  mid: "bg-sky-400/15 text-sky-300",
  close: "bg-purple-400/15 text-purple-300",
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

/** 排班表格子里整张卡片的颜色（边框 + 底 + 班名字色）；没匹配到的班次类型走兜底。 */
const CARD_FALLBACK = "border-white/25 bg-white/[.08] text-white";
const SHIFT_CARDS: Record<string, string> = {
  open: "border-emerald-400/40 bg-emerald-400/[.12] text-emerald-300",
  mid: "border-sky-400/40 bg-sky-400/[.12] text-sky-300",
  close: "border-purple-400/50 bg-purple-400/[.16] text-purple-200",
};

export function shiftCardClass(key: string | null): string {
  if (!key) return CARD_FALLBACK;
  return SHIFT_CARDS[key] ?? CARD_FALLBACK;
}

export function shiftColorClass(key: string | null): string {
  if (!key) return FALLBACK_SHIFT_COLOR;
  return SHIFT_COLORS[key] ?? FALLBACK_SHIFT_COLOR;
}

/** 休假在格子里的名字（后端值 pto / sick / personal）。 */
export const TIME_OFF_LABEL: Record<string, string> = {
  pto: "PTO",
  sick: "Sick",
  personal: "Personal",
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
