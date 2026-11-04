/**
 * 班次类型的颜色（Annie 2026-11-04「排班这个全部同意推荐，动手吧」，置顶 85 Q3 A，preview 9LFRCau1uBg5sQ5aPbdSZt）：
 * 8 种里选一种，后端 schedule_shift_types.color 存颜色名。旧后端没有 color 字段时：open / mid / close 照原来的颜色，其余灰白。
 *
 * 格子颜色在很多地方画（周表、Add shift、Auto-fill、Dashboard、员工确认页），有的地方手上没有班次类型列表，
 * 所以读到班次类型的地方（fetchScheduleSettings、确认页）都先记一下 key → 颜色，画的时候按 key 查。
 */
export const SHIFT_COLORS = [
  "open",
  "mid",
  "close",
  "amber",
  "rose",
  "teal",
  "orange",
  "grey",
] as const;

export type ShiftColor = (typeof SHIFT_COLORS)[number];

/** 色块 / 选色小窗里那一格的底色（同 preview）。 */
export const SHIFT_SWATCH: Record<ShiftColor, string> = {
  open: "rgba(52,211,153,.5)",
  mid: "rgba(56,189,248,.5)",
  close: "rgba(192,132,252,.55)",
  amber: "rgba(251,191,36,.55)",
  rose: "rgba(251,113,133,.55)",
  teal: "rgba(45,212,191,.5)",
  orange: "rgba(251,146,60,.55)",
  grey: "rgba(255,255,255,.25)",
};

/** 读给人听的颜色名（选色小窗的 aria-label / title）。 */
export const SHIFT_COLOR_NAME: Record<ShiftColor, string> = {
  open: "Green",
  mid: "Blue",
  close: "Purple",
  amber: "Yellow",
  rose: "Pink",
  teal: "Teal",
  orange: "Orange",
  grey: "Grey",
};

export function isShiftColor(value: unknown): value is ShiftColor {
  return (
    typeof value === "string" &&
    (SHIFT_COLORS as readonly string[]).includes(value)
  );
}

/** 没有 color 字段（旧后端）时按 key 给的颜色。 */
export function defaultShiftColor(key: string | null): ShiftColor {
  return key === "open" || key === "mid" || key === "close" ? key : "grey";
}

const remembered = new Map<string, ShiftColor>();

/** 读到班次类型时记下 key → 颜色；不认得的颜色名不记（照默认）。 */
export function rememberShiftTypeColors(
  types: readonly { key: string; color?: string | null }[] | undefined,
): void {
  for (const t of types ?? []) {
    if (isShiftColor(t.color)) remembered.set(t.key, t.color);
  }
}

export function shiftColorOf(key: string | null): ShiftColor {
  return (key ? remembered.get(key) : undefined) ?? defaultShiftColor(key);
}
