/**
 * GET /api/forecast/60-day —— CCL（Canyon Coach Lines）调度表那样的 60 天预测，按巴士团路线分块。
 * 取代原来的 30-day（只有一个总数、不分块）；30-day 接口还在，但这页不再用它（后端 app/services/forecast.py）。
 */

/** 块里细行的种类：tour = 团本身，outbound / inbound = 同一台车的去 / 回程（两个方向合计才是 Total 里的那一部分）。 */
export type ForecastRowKind = "tour" | "outbound" | "inbound";

export interface ForecastRow {
  label: string;
  kind: ForecastRowKind;
  /** 60 天，和 ForecastData.days 一一对应。 */
  values: number[];
}

/** CCL 在 Discord 发的一行（司机 / 导游 / 车牌等），只读。 */
export interface ForecastCrewLine {
  bus_label: string | null;
  driver: string | null;
  guide: string | null;
  vehicle: string | null;
  is_driver_guide: boolean;
  route: string | null;
  note: string | null;
  /** 后端拼好的可读文案，优先显示；为空时前端自己从其余字段拼一份兜底。 */
  readable: string | null;
  raw: string | null;
  /** 车号对上 Settings → Vehicles 里没接 Samsara 的车（没 GPS），车号标红（G63）。 */
  no_gps?: boolean;
}

/** staff 排的导游（可编辑）。 */
export interface ForecastPlanGuide {
  /** 这条排班记录自己的 id（DELETE /api/forecast/guide-plan/{id} 用这个，不是 hr_id）。 */
  id: number;
  name: string;
  hr_id: number | null;
}

/** 某一天某个块的 Driver / Guide 格子：CCL 已经发过名单（只读）或 staff 自己排的（可编辑）。 */
export type ForecastCrewDay =
  | {
      source: "ccl";
      closed: boolean;
      closed_note: string | null;
      lines: ForecastCrewLine[];
      /**
       * 这个块是「单独成块」的节（block.section 非空）：CCL 的名单按它自己的大板块对到 manifest_id，
       * 分不出组里单独成块的那一节，车都记在主块（section ""）上——true 时 lines 恒为空，不代表
       * 「CCL 确认这天没车」，页面要显示成「见主块」占位，不能当成普通的「—」。
       */
      in_main_block: boolean;
    }
  | {
      source: "plan";
      guides: ForecastPlanGuide[];
    };

export interface ForecastBlock {
  manifest_id: number;
  /**
   * 空串 = 这条线的主块；否则是这条线「单独成块」的节名（原样，取 Settings → Products → Manifest setup
   * 里组配置的写法，如 "Sunset"）。同一个 manifest_id 可能对应好几个块（主块 + 若干单独成块的节），
   * 块的身份要按 (manifest_id, section) 一起认，不能只看 manifest_id（后端 forecast-sections 包，2026-10-09）。
   */
  section: string;
  /** 后端已经拼好「路线名 · 节名」（节是主块时就是路线名本身），不用前端自己拼。 */
  name: string;
  is_active: boolean;
  /** 60 天：团行之和 + max(outbound, inbound)（同车两趟）。只算 confirmed。 */
  total: number[];
  /**
   * 细行。只有一行、且这行的 values 和 total 完全一样时（纯重复），页面不画这一行、只显示 Total——
   * 调用方（forecast-grid）按这条规则过滤，这里原样保留接口给的全部行。
   */
  rows: ForecastRow[];
  /** 60 天，和 total/rows[].values 同步对应每一天的 Driver / Guide 信息。 */
  crew: ForecastCrewDay[];
  // ── G63（后端 4f，2026-10-15）。都是可选：后端没上线时页面照旧。──
  /** false = 那天不开团（Products 设的每周不开 / 停开日期，或 CCL Discord 写 Closed）。 */
  running?: boolean[];
  /** 不开团的原因（"Not running on Mondays"、停开日期的备注或 "Closed"、CCL 的话）；开团是 ""。 */
  closed_reason?: string[];
  /** 设了上限的行（只有设了的才有），顺序同 rows。 */
  allotments?: ForecastAllotment[];
  /** staff 手写的格子（Annie 2026-10-15：没同步的先手写），每个 60 天，"" = 没写。 */
  cells?: Partial<Record<ForecastBlockCellKey, string[]>>;
  cells_meta?: Partial<
    Record<ForecastBlockCellKey, (ForecastCellMeta | null)[]>
  >;
  /** 当天已确认订单在 Rezdy 的出发时间（如 "4:30 PM"），没有是 ""。Sunset 块的出发时间行用。 */
  depart_times?: string[];
  /** 只有在 Products 勾了「List each order」的块才有：每天的订单（CCL 的 PRIVATE TOURS）。 */
  orders?: ForecastBlockOrder[][];
  /** G81（后端 f0，2026-10-16）：这块每天有没有在表上手改开关团，长度同 days；null = 没改。 */
  running_meta?: (ForecastRunningMeta | null)[];
}

/** 表上手改「这天开不开团」的记录；running / reason 是手改的值。 */
export interface ForecastRunningMeta {
  running: boolean;
  reason: string;
  /** CCL 在 Discord 写了 Closed：手动 true 存得进去但不生效，那天仍是关。 */
  overridden_by_ccl: boolean;
  updated_by: string;
  updated_at: string;
}

/** 表上手改某天某档上限 / 时间的记录。 */
export interface ForecastDayAllotmentMeta {
  max: number;
  time: string;
  updated_by: string;
  updated_at: string;
}

/** 一行（节）的上限（Products → Bus Manifest setup 设，可按日期段改）。 */
export interface ForecastAllotment {
  label: string;
  /** 平常（不在日期段里）的时间 / 上限；只设了日期段的行是 null。 */
  normal_time: string | null;
  normal_max: number | null;
  /** 60 天：当天的时间 / 上限（日期段优先），没有上限那天 max 是 null。 */
  time: string[];
  max: (number | null)[];
  /** 当天已确认人数（同 rows[].values）。 */
  sold: number[];
  /** max − sold，卖超是负数；max 是 null 那天也是 null。 */
  inventory: (number | null)[];
  /** G81：这一天有没有在表上手改，长度同 days；null = 没改。 */
  day_meta?: (ForecastDayAllotmentMeta | null)[];
}

export type ForecastBlockCellKey =
  "crew_notes" | "pax_tours" | "driver_vehicle";
export type ForecastPageCellKey = "major_events";

export interface ForecastCellMeta {
  updated_by: string;
  updated_at: string;
}

export interface ForecastBlockOrder {
  order_number: string;
  pax: number;
  product: string;
  pickup_location: string | null;
  /** 已经减过 15 分钟（同别处）。 */
  pickup_time: string | null;
}

export interface ForecastUnassignedProduct {
  product_code: string;
  product_name: string;
  pax: number;
}

/**
 * 车型上色档位，有序数组，后端给的顺序即判断顺序；最后一档 `max: null` 代表「比前面都高」。
 * 空数组 = 后端 SQL seed 还没跑，页面按「不上色」处理（没有图例、没有上色，Total 按普通样式显示）。
 * 具体阈值和颜色名全部来自接口，前端不写死。
 */
export interface ForecastVehicleTier {
  max: number | null;
  vehicle: string;
  color: string;
}

export interface ForecastGuideOption {
  id: number;
  name: string;
}

export interface Forecast60Day {
  /** YYYY-MM-DD，洛杉矶今天。 */
  today: string;
  /** 60 个 YYYY-MM-DD，today 是第 0 个。 */
  days: string[];
  blocks: ForecastBlock[];
  /** 挂不上任何路线的 CCL 行，按日期分组；只有真的有行的日期才会出现在这里。 */
  ccl_other: Record<string, ForecastCrewLine[]>;
  unassigned: ForecastUnassignedProduct[];
  vehicle_tiers: ForecastVehicleTier[];
  guides: ForecastGuideOption[];
  // ── G63 页面级（可选）──
  /** 整页一行的手写格子（CCL major events），60 天。 */
  page_cells?: Partial<Record<ForecastPageCellKey, string[]>>;
  page_cells_meta?: Partial<
    Record<ForecastPageCellKey, (ForecastCellMeta | null)[]>
  >;
  /** Day Tour Live Link（只收 http:// / https://），"" = 没设。 */
  live_link?: string;
  /** 最后一个改过手写格子的人（CCL 的 Updated by）。 */
  updated_by?: { name: string; at: string } | null;
}

/** PUT /api/forecast/cells。date / manifest_id 按 row_key 省略（live_link 两个都不带，major_events 不带 manifest_id）。 */
export interface ForecastCellInput {
  row_key: ForecastBlockCellKey | ForecastPageCellKey | "live_link";
  date?: string;
  manifest_id?: number;
  section?: string;
  /** ≤500 字，"" = 删掉。 */
  value: string;
}

export interface ForecastCellResult {
  ok?: boolean;
  value: string;
  /** 清空（删掉）时后端回 "" 和 null。 */
  updated_by: string;
  updated_at: string | null;
}

// ── Settings → Products → Bus Manifest setup 里的 Forecast 设置（admin，G63）──

export interface ForecastSettingsBlock {
  manifest_id: number;
  section: string;
  name: string;
  rows: string[];
}

export interface ForecastRunDays {
  manifest_id: number;
  section: string;
  /** 0 = 星期一（洛杉矶日期）。没在清单里的块天天开。 */
  weekdays: number[];
}

export interface ForecastClosedDate {
  id: number;
  manifest_id: number;
  section: string;
  date_from: string;
  date_to: string;
  note: string;
}

export interface ForecastAllotmentSetting {
  /** 日期段那几条才有意义（DELETE 用）；平常上限按 manifest_id + row_label 认。 */
  id: number | null;
  manifest_id: number;
  row_label: string;
  /** 后端推出来的、这行属于哪个块，只用来显示。 */
  section: string;
  time_label: string;
  max_pax: number;
  /** null = 平常上限；有日期 = 这段日子换一个上限。 */
  date_from: string | null;
  date_to: string | null;
}

/**
 * 对不上的设置。删法（后端 4f）：run_days ⇒ PUT run-days 七天全勾；closed_date ⇒ DELETE closed-dates/{id}；
 * allotment ⇒ date_from 为 null 删平常上限，否则 DELETE allotments/dates/{id}；order_detail ⇒ PUT 清单去掉它。
 */
export interface ForecastUnmatchedSetting {
  kind: "run_days" | "closed_date" | "allotment" | "order_detail";
  manifest_id: number;
  section: string | null;
  row_label: string | null;
  id: number | null;
  date_from?: string | null;
  /** 后端写好的一句话，例 'Max allotments for "VIP LOWER" (25, 11a)'。 */
  label: string;
}

export interface ForecastSettings {
  blocks: ForecastSettingsBlock[];
  run_days: ForecastRunDays[];
  closed_dates: ForecastClosedDate[];
  allotments: ForecastAllotmentSetting[];
  /** 存过、但块或行已经对不上的设置（节改了名），给 admin 删。 */
  unmatched: ForecastUnmatchedSetting[];
  /** 在 60-day 里带 orders 的块（CCL 的 PRIVATE TOURS）。 */
  order_detail_blocks: { manifest_id: number; section: string }[];
}

export interface ForecastGuidePlanInput {
  run_date: string;
  manifest_id: number;
  /** 这个块自己的 section（主块传 ""／不传，后端按 "" 处理）。 */
  section?: string;
  /** 二选一：选中已有候选人传这个。 */
  guide_hr_id?: number;
  /** 二选一：手打的名字（不在候选名单里）传这个。 */
  guide_name?: string;
}

export interface ForecastGuidePlanResult {
  ok: boolean;
  guide: {
    id: number;
    run_date: string;
    manifest_id: number;
    section: string;
    hr_id: number | null;
    name: string;
  };
}

// ── G81：表上按天改 + Action Log（后端 f0，2026-10-16）──

export interface ForecastDayRunningInput {
  date: string;
  manifest_id: number;
  section: string;
  /** null = 撤掉手改，回到自动结果。 */
  running: boolean | null;
  /** ≤200 字；running 为 false 时显示的原因，空 = "Closed"。 */
  reason: string;
}

export interface ForecastDayAllotmentInput {
  date: string;
  manifest_id: number;
  row_label: string;
  /** ≤20 字；改上限要把这天现在显示的时间一起传回，不传这天的时间会变空。 */
  time_label: string;
  /** 1–9999；null = 撤掉这天的手改（此时 time_label 被忽略）。 */
  max_pax: number | null;
}

/** changed: false = 值没变，后端没写库也没记日志。 */
export interface ForecastDayEditResult {
  ok: boolean;
  changed: boolean;
}

export interface ForecastLogItem {
  at: string;
  by: string;
  tour: string;
  date: string | null;
  what: string;
  from: string;
  to: string;
}

export interface ForecastLogPage {
  items: ForecastLogItem[];
  /** 字符串，原样传回 before；null = 没有更早的了。 */
  next_cursor: string | null;
}
