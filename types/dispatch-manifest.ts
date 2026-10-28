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
  /** G65：取消 / 改到别处、留在名单上显示 0 人的单数（不算进 pax / guests）。旧后端没有这个字段。 */
  gone_orders?: number;
  /** G65：主 Manifest 里找不到、原因不明的单数（照算人数、橙字）。 */
  missing_orders?: number;
}

/** G65：名单上这一行和主 Manifest 对不上的情况。null = 正常。 */
export type ManifestSyncStatus = "cancelled" | "moved" | "missing" | null;

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
  /**
   * Special Requirements 可编辑（Annie 2026-10-18）：`notes` 是「有效值」（staff 改过就是改后的）；
   * `notes_edited` = staff 改过（含删空）；`rezdy_notes` = Rezdy 原文（Reset 用）。
   * 后端没带 `notes_edited`（还没上线）⇒ 这一格只读，页面照旧。
   */
  notes_edited?: boolean;
  rezdy_notes?: string | null;
  /** 票种里有 "+"：标黄。 */
  ticket_hl: boolean;
  /** 产品挂的 Extra 名（Bus Manifest setup，例 Heli）；没有为 ""。有值时整行用 `extra_row_color`。 */
  extra?: string;
  /** G65：只会是 null 或 "missing"（取消 / 改期的行在 ManifestView.gone 里）。 */
  sync_status?: ManifestSyncStatus;
  /** missing 时「Not in main manifest — check Rezdy」。 */
  sync_note?: string | null;
}

/** G65：取消 / 改期、留在名单上的单（不在车上、不算总数）。pickup_time 已减 15。 */
export interface ManifestGoneGuest {
  id: number;
  order_number: string;
  name: string;
  product: string;
  pickup_time: string;
  pickup_location: string;
  /** 原来在哪台车；没分过车为 null / ""。 */
  bus_label: string | null;
  pax: 0;
  was_pax: number;
  sync_status: "cancelled" | "moved";
  /** 例「Cancelled in Rezdy (Oct 14, 8:12 PM)」「Moved to 10/15 South Rim」。 */
  sync_note: string;
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
  /**
   * G198（后端 8a）：只有 kind "tour" 的节带。这一节在 Manifest setup 勾了「Cfm #」时为 true，
   * 这时 `heading` 是后端拼好的打印版（「UPPER 12:40P (CHECK-IN 12:10P) - 18 PAX · CFM # 4471」，缺的部分不写）。
   * 没有这个键 = 后端没上线（照旧显示黄框）；有这个键就不再画黄框（打印 / Excel 也去掉了）。
   */
  show_cfm?: boolean;
  /** G198：这一节的 Cfm #（Main Manifest 按日期 + 团 + 节填一次）；开了格时是号或 ""，没开格是 null。 */
  cfm_no?: string | null;
  /** G198：Max allotments 的 Time 原文，例 "12:40P"；没设是 ""。 */
  tour_time?: string;
  /** G198：tour_time 减 30 分钟，写法同 tour_time；没设或读不懂是 ""。 */
  checkin_time?: string;
}

/** G198 午餐表的一行（后端 `lunch_sheet()`）。`defaulted` = 读不出三明治、按默认算，整行标黄。 */
export interface ManifestLunchRow {
  name: string;
  pax: number;
  turkey: number;
  veggie: number;
  beef: number;
  defaulted: boolean;
  /** 三明治读不准时的 Rezdy 原文（Notes 列红字）。后端现在不带，带了才画。 */
  check_text?: string;
}

/** G198：每台车后面接的 Bee's 午餐表（团没分配午餐店时为 null，不出）。 */
export interface ManifestLunch {
  /** 例 "Bee's Marketplace"（G199 前的暂定字段，后端没带过；有 `title` 时不看它）。 */
  vendor?: string;
  /** G199（后端 8a）：抬头「NPE Lunch Box - 店名」，后端拼好，照原文显示。 */
  title?: string;
  /** G199：店名。 */
  restaurant?: string;
  /** title 后端已拼好，例「LOWER 1P - 12 PAX」，照原文显示。 */
  sections: { title: string; rows: ManifestLunchRow[] }[];
  totals: { pax: number; turkey: number; veggie: number; beef: number };
  /** 页脚（最多两行，用 \n 分开，换行照印）。 */
  note: string;
}

/** G197 一层字号设定：`d` 整数 px（−2..+10），`bold` 不设 = 跟下一层。 */
export interface ManifestTextLayer {
  d?: number;
  bold?: boolean;
}

/** G197：一台车那张表存的字号（全页 / 整列〔列键〕/ 整行〔订单号〕）。 */
export interface ManifestTextSize {
  page: ManifestTextLayer;
  columns: Record<string, ManifestTextLayer>;
  rows: Record<string, ManifestTextLayer>;
}

export interface ManifestTextSizeChange {
  by: string;
  at: string;
  what: string;
}

export interface ManifestTotals {
  pax: number;
  guests: number;
  boarded: number;
  no_show: number;
  /** 只在整团的 `totals` 上有：我们车上的人 / 转单（Affiliate）的人；`pax` = 两者之和，页面不展示总和。 */
  pax_ours?: number;
  pax_farm_out?: number;
}

/**
 * 被转单（Farm out）的客人，整个团一栏，标题只写 Affiliate（Annie 2026-10-18）：
 * 不分车、不分合作公司，整个 JSON 不含 partner_name；形状同 `unplaced`。旧后端没有这个键。
 */
export interface ManifestAffiliate {
  sections: ManifestSection[];
  /** 转单客人自己的合计，只给 Affiliate 栏底部用，别加进主表。 */
  totals: ManifestTotals;
  empty_notes: boolean;
}

export interface ManifestFooterCell {
  label: string;
  value: number | null;
  /** Extra 的「<名字> SEATS LEFT」格（Bus Manifest setup 里设的，底色不同）。 */
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
  /** G198：这台车的午餐表；没有这个键（后端没上线）或 null（团没分配午餐店）都不出。 */
  lunch?: ManifestLunch | null;
  /** G197：存好的字号；没有这个键 = 后端没上线（不出 Text size 键，照纸本默认画）。 */
  text_size?: ManifestTextSize;
  /** G197：最近 5 条改动（新的在前）。 */
  text_size_history?: ManifestTextSizeChange[];
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
    /** G198：底部确认号黄框出不出（后端 `confirm_boxes()`）：Manifest setup 开了 Cfm # 格的组 false；没带 = 照旧出。 */
    confirm_box?: boolean;
  };
  shuttle_colors: { outbound: string; inbound: string };
  /** Extra 客人整行的底色（后端 `EXTRA_ROW_COLOR`）。 */
  extra_row_color?: string;
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
  affiliate?: ManifestAffiliate;
  /** G65：取消 / 改期的单，单独一组显示 0 人和原因；旧后端没有这个字段。 */
  gone?: ManifestGoneGuest[];
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
    /** G65：留在名单上、主 Manifest 里没有的单。removed 现在是「这次从正常变成取消 / 改期」的行数，不再删。 */
    kept?: {
      order_number: string;
      sync_status: "cancelled" | "moved" | "missing";
      sync_note: string;
    }[];
  }[];
}

/**
 * `GET /api/dispatch/pending`（后端 G56，2026-10-12 草稿）：staff 点了 Completed 以后名单又变了的单，一单一种变化一条。
 * 只返回还没处理的；按团顺序、再按先后。
 */
export interface DispatchPendingItem {
  id: number;
  manifest_id: number;
  tour: string;
  order_number: string;
  kind: "added" | "removed" | "changed";
  /** added「2 pax · 5:15 AM MGM Grand」/ removed「2 pax」/ changed 用「; 」连起来的短句。 */
  detail: string;
  /** 变化前在哪台车（「A」或「A, B」）；新单为 null。 */
  old_bus: string | null;
  /** 影响到哪一轮 / 哪台 Morning Relay 车；后端还没填时是 ""。 */
  relay: string;
  created_at: string;
}
