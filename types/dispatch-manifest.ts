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
  lunch?: { turkey: number; veggie: number; beef: number };
  file_name?: string;
  uploaded_at?: string | null;
  uploaded_by?: string;
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

export interface ManifestBrief {
  order_number: string;
  name: string;
  pax: number;
  product: string;
  pickup_time: string;
  pickup_location: string;
}

/** 上传预览（不写库）。 */
export interface ManifestUploadPreview {
  added: ManifestBrief[];
  removed: (ManifestBrief & {
    bus_label: string | null;
    boarding: string | null;
  })[];
  changed: (ManifestBrief & { changes: string[] })[];
  unchanged: number;
  rows: number;
  pax: number;
  first_upload: boolean;
}
