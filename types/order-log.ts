/** GET /api/activities/order-log 的一行（后端已把日期格式化成显示用的文字）。 */
export interface OrderLogRecord {
  id: number;
  order_number: string;
  /** "3/7/2026" 或 "—"。 */
  tour_date: string;
  event_type: string;
  event_label: string;
  /** #RRGGBB；没有映射的是 #888。 */
  event_color: string;
  detail: string;
  /** 员工名 / 客人名；没有为 "—"。 */
  actor: string;
  /** staff / guest；没有为 "—"。 */
  actor_type: string;
  /** "3/7/2026 2:05 PM"（洛杉矶）。 */
  modified_at: string;
}

export interface OrderLogPage {
  total: number;
  page: number;
  /** 各事件类型的条数（同一组筛选条件，不分页）。 */
  stats: Record<string, number>;
  records: OrderLogRecord[];
}

export interface OrderLogQuery {
  /** 按**操作日期**（洛杉矶）筛，只能一天。 */
  date: string;
  orderNumber: string;
  eventType: string;
  actorType: string;
  page: number;
}
