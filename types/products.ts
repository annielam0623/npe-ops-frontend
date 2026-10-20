/** GET /api/settings/products 的一个商品（Rezdy 产品代码一行）。 */
export interface Product {
  id: number;
  product_code: string;
  /** Rezdy 来的名字，webhook 每次推送都会覆盖，本页不能改。 */
  product_name: string;
  /** 我们自己的短名，Rezdy 不碰。 */
  internal_name: string;
  /** 所属组（manifests.id）；没有为 null。 */
  manifest_id: number | null;
  /** 分类：决定订单算进哪些报表。null = 本表不下结论，订单落回自己存的值。 */
  booking_type: string | null;
  is_active: boolean;
  group_name: string | null;
  group_sort: number | null;
  /**
   * 门票 tour type 的键（只有 booking_type = ticket 的产品才有），决定 Manifests 的 Tickets 标签里归哪颗胶囊。
   * 后端 manifests-fields 包落地前的接口没有这个字段（undefined）。
   */
  ticket_tour_type?: string | null;
  /**
   * 不是门票的产品（巴士团等）默认的 tour type 键（后端 auto-send，migrate_v95）：定时自动发送按它发团确认，
   * 人工发送弹窗用它预填。null = 还没配（自动发送跳过）。后端没上线时没有这个字段。
   */
  bus_tour_type?: string | null;
}

export interface ProductGroup {
  id: number;
  name: string;
  display_name: string;
  booking_type: string | null;
  is_active: boolean;
  sort_order: number | null;
}

export interface ProductGroups {
  groups: ProductGroup[];
  /** 合法分类，由后端下发（webhook.py 的 _KNOWN_BOOKING_TYPES），前端不写死。 */
  booking_types: string[];
  /** 门票 tour type 的下拉选项（label 已去重），前端不写死；后端 manifests-fields 包落地前没有。 */
  ticket_tour_types?: TicketTourType[];
  /** 巴士团 tour type 的下拉选项（同人工发 Tour confirmation 弹窗那一份）；后端没上线时没有。 */
  bus_tour_types?: TicketTourType[];
}

export interface TicketTourType {
  key: string;
  label: string;
}

/** 订单上出现过、但还不在列表里的产品代码。 */
export interface MissingProduct {
  product_code: string;
  product_name: string;
  upcoming_rows: number;
  total_rows: number;
  first_date: string;
  last_date: string;
}

export interface ProductLogEntry {
  id: number;
  entity_id: string;
  /** 产品代码。 */
  label: string;
  action: "create" | "update" | "deactivate" | "reactivate";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  actor_name: string;
  created_at: string;
}

export interface ProductCreateInput {
  product_code: string;
  product_name: string;
  internal_name: string;
  manifest_id: number | null;
  booking_type: string;
}

/** 单个修改：⚠️ 整体覆盖，三项都要传，缺的会被清空。 */
export interface ProductUpdateInput {
  internal_name: string;
  manifest_id: number | null;
  booking_type: string;
}

/** 批量：只改带了的键；带了但为空 = 清空。 */
export interface ProductBulkInput {
  ids: number[];
  manifest_id?: number | null;
  booking_type?: string;
  /** 门票 tour type 的键或 null（清空）。选中的产品里有非门票的，后端整批 400、一个都不改。 */
  ticket_tour_type?: string | null;
  /** 巴士团 tour type 的键或 null。要单独应用；选中的产品里有门票的，后端整批 400（清空不限）。 */
  bus_tour_type?: string | null;
}

export interface ProductBulkResult {
  updated: number;
  unchanged: number;
  missing: number;
}

// ── Manifest setup ──────────────────────────────────────────────────────────

/** roundtrip：当天来回的 shuttle（后端 G36，migrate_v88）——客人在去程节、回程节各出现一次。 */
export type ManifestSectionKind = "tour" | "outbound" | "inbound" | "roundtrip";

/**
 * Bus Manifest 的 Extra（后端 2026-10-12 `ad8b7ab`，migrate_v87）：Heli 这类 combo 产品。客人留在自己的节、整行标色，
 * 底部多一格「NAME SEATS LEFT」。取代了原来按票型字眼计数的 counters（接口过渡期还返回 `counters: []`，不读）。
 */
export interface ManifestExtra {
  id: number;
  name: string;
  seats: number;
}

export interface ManifestSetupProduct {
  id: number;
  manifest_id: number;
  product_code: string;
  product_name: string;
  internal_name: string;
  is_active: boolean;
  manifest_section: string;
  manifest_section_kind: ManifestSectionKind;
  /** 挂的 Extra（只有 kind tour 的产品能挂）；null = 没挂。 */
  manifest_extra_id: number | null;
  /** 往返 shuttle 的回程接客时间 / 地点（G36；"" = 没填，manifest 上写 not set）。只有 kind roundtrip 用。 */
  return_pickup_time: string;
  return_pickup_place: string;
}

/** 一节的默认 tour type（后端 G130，migrate_v110）：section "" = 这个团的主块；tour_type null = 没设。 */
export interface SectionTourType {
  section: string;
  tour_type: string | null;
}

export interface ManifestSetupGroup {
  id: number;
  display_name: string;
  is_active: boolean;
  manifest_color: string | null;
  manifest_lunch_note: string | null;
  /** Dispatch 按 ceil(人数 / 它) 开几辆车（后端 `c5b8633`，migrate_v81，1–99，默认 54）。 */
  guests_per_bus: number;
  /** 60 天 Forecast 上单独成一块的节（后端 `a48311e`，migrate_v82，最多 6 个）。 */
  forecast_split_sections: string[];
  /**
   * 这个团各节从上到下的顺序（后端 G50，migrate_v85）：Forecast 的小行和 Manifests 的分节都按它。
   * 列了的按列的顺序在前，没列的 A–Z 在后；班车永远最后（去程在回程前）。[] = 旧的排法。
   */
  section_order: string[];
  /**
   * Morning Relay 第几轮（后端 7c 减 15，Annie 2026-10-14：分轮按团、不按时间）："relay" / "relay_2" / null = 不进 Relay。
   * 后端没上线时没有这个键。
   */
  relay_round?: string | null;
  extras: ManifestExtra[];
  products: ManifestSetupProduct[];
  /** 每个有 Tour 产品的节一行（班车节不列），按节名排；后端没上线 G130 时没有这个键。 */
  section_tour_types?: SectionTourType[];
}

export interface ManifestSetup {
  groups: ManifestSetupGroup[];
  kinds: { value: ManifestSectionKind; label: string }[];
  default_section: string;
  /** Relay round 下拉（value "" = Not on Morning Relay）。后端没上线时没有 ⇒ 不显示这项设置。 */
  relay_rounds?: { value: string; label: string }[];
  /** 每节 tour type 下拉能选的键（后端 G130）。 */
  tour_types?: { key: string; label: string }[];
}
