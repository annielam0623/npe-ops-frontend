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
/** 手机（窄于 640px）上路线名那列收窄、名字可折行，一屏能看到两三天（Annie 2026-10-13）。 */
export const FIRST_COL_WIDTH_PHONE = 112;
export const PHONE_QUERY = "(max-width: 639px)";
export const DAY_COL_WIDTH = 74;
/** 有 Driver / Guide 内容的那一天加宽，司机 / 导游的安排最多折两行（Annie 2026-10-13）。 */
export const CREW_DAY_COL_WIDTH = 150;
/** 有 Max allotments 的日子至少这么宽：每档一行「U 18 /20 11a」放得下（Annie 2026-10-15：尽量保持 3 行）。 */
export const ALLOT_DAY_COL_WIDTH = 88;
/** 剩几位的数字：浅蓝，同 Main Manifest 胶囊人数在深色底的 night:text-sky-300（Annie 2026-10-15）。 */
export const SEATS_LEFT_COLOR = "#7dd3fc";

/** 今天那一列左右两条竖线（Annie 2026-10-16：连贯不断，团的标题行也画）。用左右边框，不用 ring（ring 会把每个格子框成一圈）。 */
/** 手机版今天那列不画框：亮框改成跟着屏幕走、套住最左边那列（forecast-grid 的 useLeadColumn）。 */
export const TODAY_COL =
  "border-x border-x-sky-400/70 max-sm:border-x-transparent";
