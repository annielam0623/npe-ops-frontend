import { apiFetch } from "@/lib/api-client";

/**
 * Content Studio → Shuttle（两层，后端 8a `task/g189-shuttle-shared`）：
 * - 公共部分 `shared`：39 条线共用的短信 / 邮件 / 客人页文字（必填，缺了发送时逐行 blocked），
 *   加 4 个客人看到的标题 / 链接文字（可选，空着回退 default）；
 * - 每条线 `groups[].products[].fields`：追加内容（Route-Specific Information + 3 个链接），可以全空。
 *
 * 读：`GET /api/settings/shuttle/products`（GET 时后端把所有 key 建好，保存不会 404）。
 * 写：沿用 Content Studio 通用的 `POST /api/template-settings/save`。**key 一律用这里返回的，不要自己拼。**
 */
export type ShuttleProductDirection =
  "outbound" | "inbound" | "roundtrip" | "tour";

export interface ShuttleSharedField {
  key: string;
  label: string;
  rows: number;
  value: string;
  /** 可插入的变量（后端给 7 个）。 */
  vars?: string[];
}

export interface ShuttleTextField {
  key: string;
  label: string;
  rows: number;
  value: string;
  /** 清空后客人看到的文字。 */
  default: string;
}

export interface ShuttleShared {
  /** 必填三项：短信、邮件、客人页文字。 */
  fields: ShuttleSharedField[];
  /** 可选的 4 个标题 / 链接文字，不参与拦截。 */
  text_fields: ShuttleTextField[];
  /** 打开页面时空着的必填项 label（页面上以 studio 里的最新值为准）。 */
  missing: string[];
  complete: boolean;
}

export interface ShuttleProductField {
  key: string;
  label: string;
  rows: number;
  /** route_info 是 dynamic_lines（一行一条，不限行数），其余三个是 url。 */
  type?: "dynamic_lines" | "url" | string;
  value: string;
}

export interface ShuttleProduct {
  product_code: string;
  product_name: string;
  /** manifest_section_kind：outbound / inbound / roundtrip；tour = 没设方向。 */
  direction: ShuttleProductDirection;
  is_active: boolean;
  /** = 公共部分填齐了且产品码没问题。 */
  sendable?: boolean;
  /** 发不了的原因（例如产品码有问题），后端原话。 */
  error?: string;
  fields: ShuttleProductField[];
}

export interface ShuttleProductGroup {
  /** 没有 Group 的 shuttle 产品放在 manifest_id = null 的一组。 */
  manifest_id: number | null;
  group_name: string;
  group_display_name: string;
  sort_order: number;
  /**
   * Group 的颜色（= Products → Manifest setup 的 `manifest_color`）。接口没带就由前端按 manifest_id
   * 去读 Manifest setup（见 `components/content-studio/shuttle-panel.tsx`）。
   */
  color?: string | null;
  products: ShuttleProduct[];
}

export interface ShuttleProductsData {
  shared: ShuttleShared;
  groups: ShuttleProductGroup[];
}

export async function fetchShuttleProducts(
  signal?: AbortSignal,
): Promise<ShuttleProductsData> {
  const data = await apiFetch<Partial<ShuttleProductsData>>(
    "/api/settings/shuttle/products",
    { cache: "no-store", signal },
  );
  return {
    shared: {
      fields: data.shared?.fields ?? [],
      text_fields: data.shared?.text_fields ?? [],
      missing: data.shared?.missing ?? [],
      complete: data.shared?.complete ?? false,
    },
    groups: data.groups ?? [],
  };
}
