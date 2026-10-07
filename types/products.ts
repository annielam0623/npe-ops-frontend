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
}

export interface ProductBulkResult {
  updated: number;
  unchanged: number;
  missing: number;
}

// ── Manifest setup ──────────────────────────────────────────────────────────

export type ManifestSectionKind = "tour" | "outbound" | "inbound";

export interface ManifestCounter {
  label: string;
  match_text: string;
  seats: number | null;
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
}

export interface ManifestSetupGroup {
  id: number;
  display_name: string;
  is_active: boolean;
  manifest_color: string | null;
  manifest_lunch_note: string | null;
  counters: ManifestCounter[];
  products: ManifestSetupProduct[];
}

export interface ManifestSetup {
  groups: ManifestSetupGroup[];
  kinds: { value: ManifestSectionKind; label: string }[];
  default_section: string;
}
