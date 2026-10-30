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
}

/** 新增 / 修改的请求体。⚠️ 修改会覆盖全部 6 项，缺的当空串，所以每次都要传全。 */
export interface PickupLocationInput {
  hotel_name: string;
  photo_url: string;
  instruction: string;
  instruction_short: string;
  aliases: string;
  map_image_url: string;
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
