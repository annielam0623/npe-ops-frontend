import { cn } from "@/lib/utils";

import type { CellState } from "./products-table";

/**
 * 旧后台 settings_products.html 的 extra_styles 照抄成 Tailwind 类（Annie 2026-10-07：和旧版一模一样）。
 * 卡片、抬头、Deactivate / Reactivate、日志和 Pickup Locations 是同一套（旧模板注释里写明），
 * 那些从 components/pickup-locations/legacy-ui 拿；这里只放这一页自己的。
 * ⚠️ cn 只拼字符串、不做 Tailwind 合并：同一个属性（颜色、底色）不能在两处都写。
 */

/** .prod-tbl thead td（字色 #999） */
export const PROD_TH_CLASS =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-3 py-2 text-left text-[11px] font-semibold text-[#999]";
/** .prod-tbl tbody td */
export const PROD_TD_CLASS = "px-3 py-2 align-middle";
/** td.pick：勾选列，窄，右边不留内边距。 */
export const PICK_TD_CLASS = "w-[28px] py-2 pr-0 pl-3 align-middle";

/** .grp-row td */
export const GROUP_ROW_TD_CLASS =
  "border-t-[0.5px] border-black/[.08] bg-[#f4f4f1] px-3 py-[7px] text-[12px] font-semibold text-[#1a1a1a]";
/** .grp-count */
export const GROUP_COUNT_CLASS = "ml-1 text-[11px] font-medium text-[#999]";

/** .code-cell */
export const CODE_CELL_CLASS =
  "font-mono text-[11px] font-semibold whitespace-nowrap text-[#1a1a1a]";
/** .rezdy-name */
export const REZDY_NAME_CLASS = "leading-[1.45] text-[#777]";

const CELL_BASE =
  "w-full rounded-[6px] border-[0.5px] px-[7px] py-1 text-[12px] focus:border-[#1a1a1a] focus:outline-none disabled:opacity-60";

/** .cell-in，按保存状态换边框和底色（saving 琥珀 / saved 绿 / failed 红）；needsCat = 还没归类的分类格（琥珀、粗体）。 */
export function cellInClass(state?: CellState, needsCat?: boolean): string {
  return cn(
    CELL_BASE,
    state === "saving"
      ? "border-[#fed7aa] bg-[#fffaf3] text-[#1a1a1a]"
      : state === "saved"
        ? "border-[#bbf7d0] bg-[#f4fdf6] text-[#1a1a1a]"
        : state === "failed"
          ? "border-[#A32D2D] bg-[#fff5f5] text-[#1a1a1a]"
          : needsCat
            ? "border-[#fed7aa] bg-[#fffaf3] font-semibold text-[#9a3412]"
            : "border-black/[.18] bg-white text-[#1a1a1a]",
  );
}

/** .bulk-bar（黑条） */
export const BULK_BAR_CLASS =
  "flex flex-wrap items-center gap-2.5 border-b-[0.5px] border-black/[.08] bg-[#1a1a1a] px-4 py-2.5 text-[12px] text-white";
/** .bulk-bar select */
export const BULK_SELECT_CLASS =
  "rounded-[6px] border-[0.5px] border-white/25 bg-[#2a2a2a] px-2 py-1 text-[12px] text-white";
/** .bulk-bar .btn-apply */
export const BULK_APPLY_CLASS =
  "cursor-pointer rounded-[6px] border-none bg-white px-3.5 py-[5px] text-[12px] font-semibold text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40";
/** .bulk-bar .btn-clear */
export const BULK_CLEAR_CLASS =
  "cursor-pointer rounded-[6px] border-[0.5px] border-white/25 bg-transparent px-2.5 py-1 text-[11px] text-[#bbb] hover:text-white";
/** .bulk-hint */
export const BULK_HINT_CLASS = "text-[11px] text-[#999]";

/** .btn-add（这一页是小号：6px 16px、12px） */
export const PROD_BTN_ADD_CLASS =
  "cursor-pointer rounded-[7px] border-none bg-[#1a1a1a] px-4 py-1.5 text-[12px] font-semibold whitespace-nowrap text-white hover:enabled:bg-[#333] disabled:cursor-not-allowed disabled:opacity-45";

/** .pill-off */
export const PILL_OFF_CLASS =
  "ml-1.5 inline-block rounded-full bg-[#f0f0ee] px-[7px] py-px align-middle text-[10px] font-semibold text-[#777]";
