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
}

/** 新增 / 修改送的整行（服务端整行存：seats 漏了会被清空）。 */
export interface VehicleInput {
  van_no: string;
  samsara_url: string;
  seats: string;
  notes: string;
  /** 改车号时必须带 true。 */
  confirm_rename?: boolean;
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
