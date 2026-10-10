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
