import { apiFetch } from "@/lib/api-client";

/**
 * Content Studio → Shuttle 模块 v2（后端 G128 重设计，**接口还是草案、没上线**）：模板按「产品」存，
 * 不再有「路线」这一层。草案文档：后端仓库分支 `task/g128-shuttle-routes-design` 的
 * `docs/content-studio-shuttle-routes-redesign-2026-10-23.md`。
 *
 * 读：`GET /api/settings/shuttle/products` → 按 Group 分组的 shuttle 产品，每个产品带 4 个字段
 * （`fields[].key` 就是 `tmpl__shuttle__{产品码小写}__{字段}`，不要自己拼）。
 * 写：沿用 Content Studio 通用的 `POST /api/template-settings/save`（这里不新增写接口）。
 */
export type ShuttleProductDirection =
  "outbound" | "inbound" | "roundtrip" | "tour";

export interface ShuttleProductField {
  key: string;
  label: string;
  rows: number;
  value: string;
}

export interface ShuttleProduct {
  product_code: string;
  product_name: string;
  /** manifest_section_kind：outbound / inbound / roundtrip；tour = 没设方向。 */
  direction: ShuttleProductDirection;
  is_active: boolean;
  /** 四个字段是否都非空。 */
  complete: boolean;
  fields: ShuttleProductField[];
}

export interface ShuttleProductGroup {
  /** 没有 Group 的 shuttle 产品放在 manifest_id = null 的一组。 */
  manifest_id: number | null;
  group_name: string;
  group_display_name: string;
  sort_order: number;
  /**
   * Group 的颜色（= Products → Manifest setup 的 `manifest_color`）。草案里没有这个字段，后端若加了就用它；
   * 没有就由前端按 manifest_id 去读 Manifest setup（见 `components/content-studio/shuttle-products-panel.tsx`）。
   */
  color?: string | null;
  products: ShuttleProduct[];
}

interface ShuttleProductsResponse {
  groups: ShuttleProductGroup[];
}

export async function fetchShuttleProducts(
  signal?: AbortSignal,
): Promise<ShuttleProductGroup[]> {
  const data = await apiFetch<ShuttleProductsResponse>(
    "/api/settings/shuttle/products",
    { cache: "no-store", signal },
  );
  return data.groups ?? [];
}
