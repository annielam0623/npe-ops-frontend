/**
 * 这页的表格是一张很宽的横向滚动大表，首列和表头都要 sticky。sticky 的格子不能靠 <tr> 的背景透出来
 * （部分浏览器下 sticky 定位的格子不会继承行背景），所以每个 sticky 格子都显式写自己的背景色；
 * 非 sticky 的格子为了同一行视觉一致，也直接用这几个常量，不单独在 <tr> 上写背景。
 * 这几个颜色是这页自己的深色表格配色（CLAUDE.md：旧页面没有对应实现时照已定的深色风格做，不用另外等 Annie 确认）。
 */
export const HEADER_BG = "#0d1b2e";
export const HEADER_TODAY_BG = "#17405f";
export const TOTAL_ROW_BG = "#13263f";
export const SUB_ROW_BG = "#0b1726";
export const CREW_ROW_BG = "#0a1522";

export const FIRST_COL_WIDTH = 190;
export const DAY_COL_WIDTH = 74;
