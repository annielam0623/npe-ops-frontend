/**
 * 排车页照旧页面 dispatch_assignments.html（+ _tour_manifests_panel / _relay_pull_panel）的样式，
 * 写成 Tailwind 类名，几个文件共用。数值逐个照旧 CSS（Annie 2026-10-07：要和旧页面一模一样）。
 * 深底上的（`.btn-ghost` / `.btn-blue` / `.dnav` …）和白卡片里的（`.tm-btn` / `.addvan` …）分开写。
 */

// ── 深底上的按钮（旧 `.dnav` `.dpick` `.btn-ghost` `.btn-blue` `.btn-discord`）──
const DARK_DISABLED = "disabled:cursor-not-allowed disabled:opacity-45";
export const DNAV = `h-8 w-8 rounded-[9px] border border-white/16 bg-white/[.04] text-[15px] leading-none text-[#cbd5e1] hover:bg-white/[.09] ${DARK_DISABLED}`;
export const DPICK = `h-8 cursor-pointer rounded-[9px] border border-white/16 bg-white/[.04] px-2.5 text-[13px] text-[#e2e8f0] tabular-nums [color-scheme:dark] ${DARK_DISABLED}`;
export const BTN_GHOST = `h-8 rounded-[9px] border border-white/18 bg-transparent px-[13px] text-[12.5px] whitespace-nowrap text-[#cbd5e1] hover:bg-white/[.07] ${DARK_DISABLED}`;
export const BTN_BLUE = `h-8 rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 text-[12.5px] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] ${DARK_DISABLED}`;
export const BTN_DISCORD = `inline-flex h-8 items-center gap-[7px] rounded-[9px] border border-[#5865F2] bg-[#5865F2] px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-white hover:border-[#4752C4] hover:bg-[#4752C4] ${DARK_DISABLED}`;

// ── 白卡片里的按钮（旧 `.tm-btn` / `.tm-btn.blue`，`.addvan`）──
const TM_BTN_BASE =
  "inline-flex h-8 items-center gap-[7px] rounded-[7px] border px-[13px] text-[13px] font-semibold whitespace-nowrap no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[15px] [&_svg]:flex-none";
export const TM_BTN = `${TM_BTN_BASE} border-[#cbd2dc] bg-white text-[#13284a] hover:bg-[#f1f4f8]`;
export const TM_BTN_BLUE = `${TM_BTN_BASE} border-[#13284a] bg-[#13284a] text-white hover:border-[#1d3a66] hover:bg-[#1d3a66]`;
export const ADDVAN =
  "h-[34px] rounded-[7px] border border-[#cbd2dc] bg-white px-3.5 text-[13px] font-medium text-[#111827] hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-50";
/** 空卡片里那个深蓝的 + Add vehicle（旧 `.emptystate .addvan`）。 */
export const ADDVAN_DARK =
  "h-[34px] rounded-[7px] border border-[#13284a] bg-[#13284a] px-[15px] text-[13px] font-semibold text-white hover:bg-[#1d3a66] disabled:cursor-not-allowed disabled:opacity-50";

// ── How to use（旧 `.howto` / `.rp-howto`：深底上自带浅蓝底）──
export const HOWTO =
  "max-w-[760px] rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3.5 text-[12px] leading-[1.8] text-[#0c3a6b]";
export const RP_HOWTO =
  "max-w-[760px] rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-[18px] py-2.5 text-[12px] leading-[1.9] text-[#0c3a6b]";
export const HOWTO_SUMMARY =
  "cursor-pointer font-semibold text-[#185FA5] [[open]>&]:mb-1.5";
export const HOWTO_OL = "m-0 list-decimal pl-[18px]";

// ── 深底上的提示条 ──
/** 旧 `.banner`（浅琥珀底）。 */
export const BANNER =
  "rounded-xl border-[0.5px] border-[rgba(138,90,0,.2)] bg-[#fdf1dd] px-4 py-[13px] text-[13px] text-[#8a5a00] [&_b]:font-bold";
/** 旧 `.errbar`（浅红底）。 */
export const ERRBAR =
  "rounded-xl border-[0.5px] border-[rgba(179,38,30,.25)] bg-[#fdeceb] px-4 py-[13px] text-[13px] text-[#b3261e]";
/** 深底上的红字（旧 `.rp-err`）。 */
export const DARK_ERR = "text-[12.5px] text-[#fca5a5]";
/** 深底上的灰字（旧 var(--muted)）。 */
export const MUTED = "text-[#94a3b8]";

// ── 白卡片里的表格（旧 `.rp-t` / `.tm-dt`）──
/** 表头 / 格子：不带上下内边距，用的地方再加（旧 `.rp-t` 6px、`.tm-dt` 7px）。cn 不合并类名，不能事后覆盖。 */
export const TH =
  "border-b border-black/12 bg-[#f3f4f2] px-2.5 text-left text-[11px] font-semibold tracking-[.04em] whitespace-nowrap text-[#666] uppercase";
export const TD = "border-b-[0.5px] border-black/[.08] align-top";
/** 旧 `.rp-t td` / `.rp-t th` 的内边距。 */
export const RP_PAD = "px-2.5 py-1.5";
/** 旧 `.tm-dt td` / `.tm-dt th` 的内边距。 */
export const TM_PAD = "px-2.5 py-[7px]";
export const MONO = "font-mono text-[12px] whitespace-nowrap";
