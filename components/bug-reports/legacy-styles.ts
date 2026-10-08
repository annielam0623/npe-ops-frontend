/**
 * Bug Reports / Task Board 两页共用的旧页面样式（bug_reports.html、task_board.html 的 extra_styles，
 * 两页这部分 CSS 一样）。照抄成 Tailwind，数值不改。
 */

/** .badge（叠了 base.html 的 .badge：22px 高、居中）。颜色另给。 */
export const BADGE_CLASS =
  "inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[20px] border border-transparent px-2 py-0.5 text-[11px] font-medium";

/** .bug-card / .task-card */
export const CARD_CLASS =
  "mb-2.5 rounded-[14px] border border-[#e2e8f0] bg-white p-4 hover:border-[#94a3b8]";

/** .bug-title / .task-title：测试脚本按 data-card-title 找标题。 */
export const CARD_TITLE_CLASS =
  "mb-1.5 text-[14px] leading-[1.4] font-semibold [overflow-wrap:anywhere] text-[#0f172a]";

/** .bug-meta / .task-meta */
export const CARD_META_CLASS =
  "flex flex-wrap items-center gap-3 text-[12px] text-[#64748b]";

/** .avatar */
export const AVATAR_CLASS =
  "size-[22px] rounded-full border border-[#e2e8f0] object-cover";

/** .avatar-placeholder */
export const AVATAR_PLACEHOLDER_CLASS =
  "inline-flex size-[22px] items-center justify-center rounded-full bg-[#e2e8f0] text-[9px] font-semibold text-[#64748b]";

/** .bug-link / .task-link */
export const CARD_LINK_CLASS =
  "text-[11px] text-[#2563eb] no-underline hover:underline";

/** .expand-panel */
export const EXPAND_PANEL_CLASS = "mt-4 border-t-[0.5px] border-[#f1f5f9] pt-4";

/** .desc-section */
export const DESC_SECTION_CLASS =
  "mb-3.5 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3.5 py-2.5";

/** .desc-text */
export const DESC_TEXT_CLASS =
  "text-[13px] leading-[1.7] [overflow-wrap:anywhere] whitespace-pre-wrap text-[#475569]";

/** .panel-label */
export const PANEL_LABEL_CLASS =
  "mb-2.5 text-[11px] font-semibold tracking-[.05em] text-[#64748b] uppercase";

/** .count（在深色底上，旧页面就是这个灰）。 */
export const COUNT_CLASS = "mb-2.5 text-[13px] text-[#64748b]";

/** .bug-loading / .tb-loading（在深色底上）。 */
export const LOADING_CLASS = "p-12 text-center text-[14px] text-[#94a3b8]";

/** .bug-error / .tb-error（在深色底上）。 */
export const ERROR_CLASS = "p-12 text-center text-[14px] text-[#ef4444]";

/** 截断警告：.bug-error 加 padding:12px; text-align:left。 */
export const TRUNCATED_CLASS = "p-3 text-left text-[14px] text-[#ef4444]";

/** .btn-refresh */
export const REFRESH_BUTTON_CLASS =
  "cursor-pointer rounded-[8px] border-0 bg-[#1a1a1a] px-3.5 py-1.5 text-[13px] text-white hover:bg-[#333]";

/** .br-filters / .tb-toolbar 里的输入框、下拉框。 */
export const TOOLBAR_INPUT_CLASS =
  "rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[13px] text-[#0f172a] outline-none";

/** 页面标题行（.br-header / .tb-header）：标题、来源说明在深色底上。 */
export const HEADER_TITLE_CLASS = "text-[15px] font-semibold text-[#f8fafc]";
export const HEADER_SUB_CLASS = "text-[12px] text-[#888]";
