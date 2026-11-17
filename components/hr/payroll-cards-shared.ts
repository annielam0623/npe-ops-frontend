import type { PayrollLock } from "@/types/guide-payroll";

/**
 * 138 Payroll 的 Pay rates / Locked dates / Change history 三张卡共用的格式和样式（5a，乙）。
 * 样子照 preview V9（docs/previews/138-guide-payroll-v9.html）。
 */

const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parts(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}
const short = (ymd: string) => `${MON[parts(ymd).m - 1]} ${parts(ymd).d}`;

/** "Nov 1–5, 2026" / "Oct 16 – Nov 5, 2026" / "Dec 20, 2026 – Jan 5, 2027" */
export function cardRangeName(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${short(from)}–${parts(to).d}, ${parts(to).y}`;
  }
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${short(from)} – ${short(to)}, ${parts(to).y}`;
  }
  return `${short(from)}, ${parts(from).y} – ${short(to)}, ${parts(to).y}`;
}

/** 价格 / 加购项的 Dates 格。 */
export function cardDatesOf(from: string, to: string | null): string {
  return to
    ? cardRangeName(from, to)
    : `From ${short(from)}, ${parts(from).y} · no end`;
}

export function cardMoney(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const FAR = "9999-12-31";

/** 起止日碰到的第一把锁（to = null 当作一直用）。 */
export function lockCovering(
  locks: readonly PayrollLock[],
  from: string,
  to: string | null,
): PayrollLock | undefined {
  return locks.find((l) => from <= l.to && (to || FAR) >= l.from);
}

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 页面先挡一遍，句子同后端原句。 */
export function amountError(v: string): string | null {
  const t = v.trim();
  if (t === "") return "Enter an amount.";
  if (!/^\d+(\.\d+)?$/.test(t)) return "Enter an amount like 230 or 66.50.";
  if (Number(t) > 100000 || /\.\d{3,}$/.test(t)) {
    return "Enter an amount from 0 to 100000, at most two decimals.";
  }
  return null;
}

export function dateError(v: string, which: "from" | "to"): string | null {
  return YMD_RE.test(v) ? null : `Use a date like 2026-11-16 for '${which}'.`;
}

export const lockSentence = (l: PayrollLock) =>
  `Pay from ${l.from} to ${l.to} is locked. Unlock it first, then save.`;

/** 表格：卡片里左右滑；第一列在手机上钉住（STICKY）。 */
export const C_WRAP = "overflow-x-auto px-4 pt-2 max-sm:px-3";
export const C_TABLE =
  "w-full border-collapse border border-[#cfd4dc] text-[13px] text-[#1a1a1a]";
export const C_TH =
  "border border-[#cfd4dc] bg-[#f1f3f6] px-3 py-2 text-left text-[11.5px] font-semibold whitespace-nowrap text-[#374151]";
export const C_TD = "border border-[#e1e5ea] px-3 py-2 align-middle";
export const C_NUM = "text-right tabular-nums whitespace-nowrap";
/** 手机上第一列钉住：底色要跟行一样（行底色变了用 bg-inherit）。 */
export const C_STICKY = "max-sm:sticky max-sm:left-0 max-sm:z-[1] bg-inherit";
export const C_GRP_TD =
  "border border-[#e1e5ea] bg-[#f6f7f9] px-3 py-1.5 text-[12.5px]";
/** 暂存的行淡黄底；要删的行淡红底 + 删除线。 */
export const C_ROW_PENDING = "bg-[#fef3c7]";
export const C_ROW_GONE = "bg-[#fde8e8] text-[#888] line-through";
export const C_DIM = "text-[#888]";
export const C_HINT = "text-[12px] leading-[1.5] text-[#4b5563]";
export const C_SUBH =
  "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-0.5 text-[13px] font-semibold max-sm:px-3";
/** 蓝色下划线字（Edit / Remove / Unlock，V9 题 11）。 */
export const C_LINK =
  "cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-[#1d4ed8] underline disabled:cursor-not-allowed disabled:opacity-50";
export const C_LOCKED = "text-[11px] whitespace-nowrap text-[#4b5563]";
export const C_FORMROW =
  "flex flex-wrap items-end gap-x-3.5 gap-y-2.5 border-y border-[#e5e7eb] bg-[#f8fafc] px-4 py-2.5 text-[12.5px] max-sm:flex-col max-sm:items-stretch max-sm:px-3";
export const C_FLABEL =
  "flex flex-col gap-[3px] text-[11.5px] font-semibold text-[#4b5563]";
export const C_INPUT =
  "rounded-[6px] border border-[#cbd2dc] bg-white px-2 py-[5px] text-[13px] text-[#1a1a1a]";
export const C_CK = "inline-flex items-center gap-1.5 text-[12.5px] font-normal text-[#1a1a1a]";
export const C_SAVEBAR =
  "flex flex-wrap items-center gap-2.5 border-t-[0.5px] border-black/[.08] px-4 py-3 max-sm:px-3";
const BTN =
  "cursor-pointer rounded-[7px] border-[0.5px] px-[13px] py-[7px] text-[12.5px] disabled:cursor-not-allowed disabled:opacity-45";
export const C_BTN = `${BTN} border-black/20 bg-white text-[#1a1a1a] hover:bg-[#f4f4f2]`;
/** 提交键：蓝 #3b82f6 白字。 */
export const C_BTN_SAVE = `${BTN} border-[#3b82f6] bg-[#3b82f6] font-semibold text-white`;
/** 只加在页面上、还要按 Save 才存的 Add：灰绿 #6b8e74 白字。 */
export const C_BTN_ADD = `${BTN} border-[#6b8e74] bg-[#6b8e74] font-semibold text-white`;
export const C_RED = "text-[12.5px] font-semibold text-[#b3261e]";
export const C_GREEN = "text-[12.5px] font-semibold text-[#1e6b43]";
export const C_CONFIRM =
  "mx-4 my-2.5 flex flex-wrap items-center gap-2 rounded-[8px] border border-[#fcd34d] bg-[#fffbeb] px-3 py-2.5 text-[12.5px] text-[#78350f] max-sm:mx-3";
