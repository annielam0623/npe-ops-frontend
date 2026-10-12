/** Dispatch → Tour manifest（后端 app/routers/tour_manifest.py）。全部 require_staff。 */

export type ManifestMode = "none" | "single" | "lettered" | "unlettered";

/** GET /api/dispatch/manifests?date= 的一张卡（排车页上的一个 bus tour 区块）。 */
export interface ManifestCard {
  manifest_id: number;
  /** 区块标题；停用的团带 " (inactive)"。 */
  title: string;
  name: string;
  buses: number;
  mode: ManifestMode;
  uploaded: boolean;
  /** 以下只在 uploaded 时有。 */
  pax?: number;
  guests?: number;
  not_on_bus?: number;
  /** 按人数要开几台车（ceil(pax / 每车几位)，服务端算）；没传名单时 null。 */
  buses_needed?: number | null;
  guests_per_bus?: number;
  /** 每台车（字母）现在坐了几位。 */
  bus_pax?: Record<string, number>;
  lunch?: { turkey: number; veggie: number; beef: number };
  file_name?: string;
  uploaded_at?: string | null;
  uploaded_by?: string;
}

/**
 * Step 1 全部团传完、staff 点过 Completed（G33，`migrate_v78`）。共享、持久化，没有取消键——
 * 任何一团重传（Apply）后端会自动清掉，前端只读。
 */
export interface GuestListsDone {
  completed_by: string | null;
  /** ISO 时刻。 */
  completed_at: string | null;
}

export interface ManifestGuest {
  id: number;
  order_number: string;
  first_name: string;
  last_name: string;
  phone: string;
  quantities: string;
  pax: number;
  product: string;
  pickup_time: string;
  pickup_location: string;
  special_requirements: string;
  bus_label: string | null;
  /** 司机在手机上标的。 */
  boarding: "boarded" | "no_show" | null;
  name: string;
  lunch_text: string;
  /** Quantities 的票种说明（例 "2 Adult, 1 Child (0-1 yrs)"）。 */
  ticket: string;
  /** 去掉三明治后的 Special Requirements；notes_check 时是 Rezdy 原文。 */
  notes: string;
  /** 三明治读不出来：notes 是原文，要人工核对。 */
  notes_check: boolean;
  /** 票种里有 "+"：标黄。 */
  ticket_hl: boolean;
}

export interface ManifestAttraction {
  checkin_time: string;
  pax_text: string;
  tour_time: string;
  confirmation_no: string;
}

export interface ManifestSection {
  /** 黄框的键（= title）。 */
  key: string;
  kind: "tour" | "outbound" | "inbound";
  title: string;
  /** 例 "LOWER ANTELOPE {32}"。 */
  heading: string;
  pax: number;
  color: string;
  guests: ManifestGuest[];
  /** 只有车的区块里有（Not on a bus 没有）。 */
  attraction?: ManifestAttraction;
  attraction_filled?: boolean;
}

export interface ManifestTotals {
  pax: number;
  guests: number;
  boarded: number;
  no_show: number;
}

export interface ManifestFooterCell {
  label: string;
  value: number | null;
  /** Settings 里设的计数格（底色不同）。 */
  custom: boolean;
}

export interface ManifestBlock {
  bus: {
    /** dispatch_assignment.id：打印单台车用。⚠️ 排车页每次保存会换。 */
    id: number;
    bus_label: string | null;
    van: string;
    seats: number | null;
    driver: string;
    guide: string;
  };
  /** 黄框存的车键：单车时 ""，否则字母。 */
  bus_key: string;
  bus_number: string;
  sections: ManifestSection[];
  totals: ManifestTotals;
  footer: ManifestFooterCell[];
  empty_notes: boolean;
}

export interface ManifestView {
  run_date: string;
  date_label: string;
  tour: {
    id: number;
    name: string;
    color: string;
    band_color: string;
    section_color: string;
    lunch_note: string;
  };
  shuttle_colors: { outbound: string; inbound: string };
  manifest: {
    id: number;
    file_name: string;
    uploaded_at: string | null;
    uploaded_by: string;
  } | null;
  mode: ManifestMode;
  /** 只在 lettered 时有值。 */
  bus_labels: string[];
  blocks: ManifestBlock[];
  unplaced: {
    sections: ManifestSection[];
    totals: ManifestTotals;
    empty_notes: boolean;
  };
  totals: ManifestTotals;
}

/**
 * `POST /api/dispatch/manifests/sync`（后端 G35）：这一天各巴士团的名单按主 Manifest 更新。
 * 过去的日子（洛杉矶）不动，`synced: false`。名单没变什么都不写（Completed 不会被清掉）。
 */
export interface DispatchSyncResult {
  ok: true;
  run_date: string;
  synced: boolean;
  tours: {
    manifest_id: number;
    added: number;
    removed: number;
    changed: number;
    rows: number;
    pax: number;
    changed_any: boolean;
    /** 人数读不出来、没放进名单的订单号。 */
    skipped_orders: string[];
  }[];
}
