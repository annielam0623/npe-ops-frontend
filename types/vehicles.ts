/** Settings → Vehicles（后端 app/routers/vehicles.py）。全部 require_admin。 */
export interface Vehicle {
  id: number;
  van_no: string;
  /** 空 = 没有 GPS（客人页不显示实时地图）。 */
  samsara_url: string;
  is_active: boolean;
  notes: string;
  seats: number | null;
  /** 排车里用过这台车的天数。 */
  scheduled_days: number;
  /** staff 自加列的值：{列 id（字符串）: 文字}。隐藏列的值也在。 */
  custom: Record<string, string>;
}

/** staff 自加的列（只收文字；不删，只隐藏）。 */
export interface VehicleColumn {
  id: number;
  label: string;
  is_hidden: boolean;
}

/** 新增 / 修改送的整行（服务端整行存：seats 漏了会被清空）。 */
export interface VehicleInput {
  van_no: string;
  samsara_url: string;
  seats: string;
  notes: string;
  /** 改车号时必须带 true。 */
  confirm_rename?: boolean;
  /** 自加列：只动送来的列；空串 = 清空那一格。不送 = 一格都不动。 */
  custom?: Record<string, string>;
}

export interface VehicleLogEntry {
  id: number;
  entity_id: string | null;
  label: string;
  action: "create" | "update" | "rename" | "deactivate" | "reactivate" | string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  actor_name: string;
  created_at: string | null;
}
