/**
 * Settings › Human Resource › Payroll（138）共用的格式化和表格样子：期间页（payroll.tsx）和
 * Pay rates / Locked dates / Change history 三张卡（payroll-rates / payroll-locks / payroll-history）一起用。
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
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}
/** "Nov 3" */
export const fmtShort = (ymd: string) => {
  const { m, d } = ymdParts(ymd);
  return `${MON[m - 1]} ${d}`;
};
/** "Mon, Nov 3" */
export const fmtDay = (ymd: string) => {
  const { y, m, d } = ymdParts(ymd);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MON[m - 1]} ${d}`;
};
/** "Nov 1–15, 2026"（同一个月）。 */
export const periodName = (from: string, to: string) =>
  `${fmtShort(from)}–${ymdParts(to).d}, ${ymdParts(from).y}`;
/** "Nov 1–5, 2026" / "Oct 28 – Nov 3, 2026" */
export const rangeName = (from: string, to: string) =>
  from.slice(0, 7) === to.slice(0, 7)
    ? periodName(from, to)
    : `${fmtShort(from)} – ${fmtShort(to)}, ${ymdParts(to).y}`;

export function money(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** 0 ⇒ "—"。 */
export const dash = (v: string | number | null | undefined) =>
  v && Number(v) ? money(v) : "—";

/**
 * 页面先挡一下的金额检查（后端会再查，400 原句照显示）。原句同后端合同：
 * "Enter an amount." / "Enter an amount like 230 or 66.50." / "Enter an amount from 0 to 100000, at most two decimals."
 */
export function amountError(v: string): string | null {
  const t = v.trim();
  if (t === "") return "Enter an amount.";
  if (!/^\d+(\.\d+)?$/.test(t)) return "Enter an amount like 230 or 66.50.";
  if (Number(t) > 100000 || /\.\d{3,}$/.test(t))
    return "Enter an amount from 0 to 100000, at most two decimals.";
  return null;
}

/** 日期在某个锁的范围里 ⇒ 那个锁。 */
export function lockCovering<L extends { from: string; to: string }>(
  locks: L[],
  from: string,
  to: string | null,
): L | undefined {
  return locks.find((l) => l.from <= (to ?? "9999-12-31") && l.to >= from);
}

export const TABLE =
  "w-full border-collapse border border-[#cfd4dc] text-[13px] text-[#1a1a1a]";
export const TH =
  "border border-[#cfd4dc] bg-[#f1f3f6] px-3.5 py-2 text-left text-[11.5px] font-semibold whitespace-nowrap text-[#374151]";
export const TD = "border border-[#e1e5ea] px-3.5 py-2.5 align-middle";
export const NUM = "text-right tabular-nums whitespace-nowrap";
/** 题 3 ① A：琥珀字状态（No rate / No guide / Not completed）。 */
export const FLAG =
  "text-[12px] font-semibold whitespace-nowrap text-[#b45309]";
/** 题 3 ② 甲：灰字 Not in HR。 */
export const NIH =
  "ml-1.5 text-[11.5px] font-medium whitespace-nowrap text-[#4b5563]";
/** 没存的格子：淡黄底（V9 td.chg）。 */
export const CHG = "bg-[#fef3c7]";
/** 蓝色下划线字（Use the price / Edit / Remove / Unlock）。 */
export const LINK =
  "cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-[#1d4ed8] underline";
/** 白色小键（Done / Cancel）。 */
export const XS_BTN =
  "cursor-pointer rounded-[5px] border border-[#888] bg-white px-[9px] py-px text-[11px] font-bold text-[#333]";
/** 金额输入框（V9 input.money）。 */
export const MONEY_INPUT =
  "w-[86px] rounded-md border border-[#cbd2dc] bg-white px-2 py-[5px] text-right text-[13px] tabular-nums text-[#1a1a1a]";
/** 蓝色提交键（Save payroll changes / Save rates / Lock dates）。 */
export const SAVE_BTN =
  "cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45";
/** 白键（Discard / Cancel / Stay）。 */
export const WHITE_BTN =
  "cursor-pointer rounded-md border border-[#cbd2dc] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#374151]";
/** 灰绿 Add（点了只加在页面上、还要 Save 才存）。 */
export const ADD_BTN =
  "cursor-pointer rounded-md border border-[#6b8e74] bg-[#6b8e74] px-3 py-1.5 text-[12.5px] font-semibold text-white";
export const ST_RED = "text-[12.5px] font-semibold text-[#b3261e]";
export const ST_GREEN = "text-[12.5px] font-semibold text-[#1e6b43]";
export const ST_DIM = "text-[12.5px] text-[#4b5563]";
/** 黄框确认 / 离开提醒（V9 .pconfirm / .guard）。 */
export const YELLOW_BOX =
  "flex flex-wrap items-center gap-2 rounded-lg border border-[#fcd34d] bg-[#fffbeb] px-3 py-2.5 text-[12.5px] text-[#78350f]";
