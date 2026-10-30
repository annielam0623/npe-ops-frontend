/** GET /api/pickup-locations 的一个酒店（接客点）。 */
export interface PickupLocation {
  id: number;
  hotel_name: string;
  /** 客人点开的网页；可能为 null。 */
  photo_url: string | null;
  /** Details：邮件和客人页面用；可能为 null。 */
  instruction: string | null;
  /** Short：短信用，最多 120 字。 */
  instruction_short: string;
  /** 逗号分隔的内部拼写，只用于匹配订单，不给客人看。 */
  aliases: string;
  /** 最多 2 个图片地址，换行分隔，顺序就是显示顺序。 */
  map_image_url: string;
  /** 停用的只是不出现在 Dispatch 的「加酒店」下拉里，匹配和已发的不受影响。 */
  is_active: boolean;
  /** 团车在这里直接上车（Treasure Island）：这里的客人不进 Morning Relay（排车页 Pull from manifests）。 */
  is_tour_departure?: boolean;
  /**
   * 类别（Annie 2026-10-29「shuttle改完Q8」「就可以动手了」，preview v3 https://claude.ai/artifact/HTezuw3d3VnNSyo63VJEzN ）：
   * 两个勾，可以都勾；两个都是 null = 还没归类（放进 Needs a type）。**没有这两个键 = 后端还没上线**，页面照旧一张 All Locations。
   */
  is_tour_bus?: boolean | null;
  is_shuttle?: boolean | null;
  /** Shuttle 站每条线路、每个季节车到这一站的时间（全部季节一次给）。没有这一格 = 那一季还没填。 */
  times?: PickupStopTime[];
}

/** 一个站 × 一条线路（Shuttle 产品）× 第几班 × 一个季节。 */
export interface PickupStopTime {
  product_id: number;
  /** 线路显示名（例 Las Vegas → St George），后端给。 */
  route_label: string;
  /** 一天第几班（Boulder City 一天两班 ⇒ 1、2）。 */
  run_no: number;
  season_id: number;
  /** 车到这一站，"HH:MM"（24 小时）；no_service 时 null。 */
  stop_time: string | null;
  /** 这一季这条线路不开。 */
  no_service: boolean;
}

/** 全站共用的季节（Annie v3 Q12 A）：写明年份，起止都含当天，不许重叠。 */
export interface ShuttleSeason {
  id: number;
  name: string;
  /** "YYYY-MM-DD" */
  starts_on: string;
  ends_on: string;
}

/** Route 下拉的一项：Manifest setup 里的 Shuttle 产品。 */
export interface ShuttleRoute {
  product_id: number;
  label: string;
}

/** 新增 / 修改的请求体。⚠️ 修改会覆盖全部 6 项，缺的当空串，所以每次都要传全。 */
export interface PickupLocationInput {
  hotel_name: string;
  photo_url: string;
  instruction: string;
  instruction_short: string;
  aliases: string;
  map_image_url: string;
  /** 后端上线了类别才带；PUT 时 times 整份换掉（一个事务）。 */
  is_tour_bus?: boolean;
  is_shuttle?: boolean;
  times?: Omit<PickupStopTime, "route_label">[];
}

export type PickupLogAction =
  "create" | "update" | "delete" | "deactivate" | "reactivate";

/** GET /api/pickup-locations/log 的一条（新的在前）。 */
export interface PickupLogEntry {
  id: number;
  entity_id: string;
  /** 酒店名（操作当时）。 */
  label: string;
  action: PickupLogAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  actor_name: string;
  /** 带时区的 ISO。 */
  created_at: string;
}
