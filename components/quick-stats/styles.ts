/**
 * G373 Quick Stats 的样式（照 preview v1 https://claude.ai/artifact/ULDTQ1GevPbDGgKEQhKF1S：深色外框 + 白卡片，
 * 表格有格线；蓝色只用在提交键 Ask / Save as card / Save / Run）。night: = 全深色主题（lib/theme.ts），平时不生效。
 */
export const CARD =
  "mb-[18px] rounded-[12px] border-[0.5px] border-black/10 bg-paper text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90 [&_[data-phone-more]]:h-7 [&_[data-phone-more]]:border-black/20 [&_[data-phone-more]]:bg-paper [&_[data-phone-more]]:px-2.5 [&_[data-phone-more]]:text-[#1a1a1a] [&_[data-phone-more-menu]]:right-auto [&_[data-phone-more-menu]]:left-0";
export const CARD_H =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b-[0.5px] border-black/[.08] px-4 py-[13px] max-sm:px-3 night:border-white/10";
export const CARD_TITLE = "text-[15px] font-semibold";
export const CARD_SUB =
  "ml-1.5 text-[12.5px] font-normal text-[#4b5563] night:text-white/55";
export const HINT =
  "text-[12px] leading-normal text-[#4b5563] night:text-white/55";
export const FOOT =
  "border-t-[0.5px] border-black/[.08] px-4 py-2.5 max-sm:px-3 night:border-white/10";

const BTN_BASE =
  "cursor-pointer rounded-[7px] border-[0.5px] px-[13px] py-[7px] text-[12.5px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 max-sm:px-2.5 max-sm:py-[5px] max-sm:text-[12px]";
const BTN_SM = "!px-[9px] !py-1 !text-[12px]";
export const BTN = `${BTN_BASE} border-black/20 bg-paper text-[#1a1a1a] hover:bg-[#f4f4f2] night:border-white/15 night:bg-white/[.04] night:text-white/90 night:hover:bg-white/[.08]`;
export const BTN_BLUE = `${BTN_BASE} border-[#3b82f6] bg-[#3b82f6] font-semibold text-white hover:bg-[#2f74e6]`;
export const BTN_DANGER = `${BTN} !text-[#b3261e] night:!text-red-300`;
export const SM = BTN_SM;

export const TABLE = "w-full border-collapse text-[13px] max-sm:text-[12.5px]";
export const TH =
  "border border-[#cfd4dc] bg-[#f1f3f6] px-3 py-2 text-left text-[11.5px] font-semibold whitespace-nowrap text-[#374151] first:border-l-0 last:border-r-0 night:border-white/10 night:bg-white/[.06] night:text-white/55";
export const TD =
  "border border-[#e1e5ea] px-3 py-[7px] align-top first:border-l-0 last:border-r-0 night:border-white/10";
export const NUM = "text-right tabular-nums whitespace-nowrap";

export const GREEN =
  "text-[12.5px] font-semibold text-[#1e6b43] night:text-emerald-300";
export const RED =
  "text-[12.5px] font-semibold text-[#b3261e] night:text-red-300";

export const BOX_WARN =
  "mx-4 my-3 rounded-[8px] border border-[#fcd34d] bg-[#fffbeb] px-3 py-2.5 text-[12.5px] leading-normal text-[#78350f] max-sm:mx-3";
export const BOX_ERR =
  "rounded-[8px] border border-[#f5c2c0] bg-[#fdf1f0] px-3 py-2.5 text-[13px] leading-normal break-words text-[#b3261e]";

export const OUTCOME_CLASS: Record<string, string> = {
  ok: "font-semibold text-[#1e6b43] night:text-emerald-300",
  refused: "font-semibold text-[#8a5a00] night:text-amber-300",
  error: "font-semibold text-[#b3261e] night:text-red-300",
  started: "font-semibold text-[#4b5563] night:text-white/55",
};

/** ISO 时间 → 洛杉矶 "Nov 23, 2:05 PM"。 */
export function laStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** ISO 时间 → 洛杉矶 "Nov 23"。 */
export function laDayShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  });
}

/** 用时：0.4 s / 20.0 s / 没有 ⇒ —。 */
export function took(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${(ms / 1000).toFixed(1)} s`;
}

export function rowsLabel(n: number | null | undefined): string {
  const v = n ?? 0;
  return `${v.toLocaleString("en-US")} ${v === 1 ? "row" : "rows"}`;
}
