import { apiFetch } from "@/lib/api-client";
import type {
  ManifestExtra,
  ManifestSectionKind,
  ManifestSetup,
  MissingProduct,
  Product,
  ProductBulkInput,
  ProductBulkResult,
  ProductCreateInput,
  ProductGroup,
  ProductGroups,
  ProductLogEntry,
  ProductUpdateInput,
} from "@/types";

/**
 * 商品设置。全部 require_admin。
 * ⚠️ 分类（booking_type）决定订单算进哪些报表（Dashboard、Orders、Sales Report、Daily Report），
 * 改了**过去的订单也跟着变**。本页没有删除。
 */
const API = "/api/settings/products";

export async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  const result = await apiFetch<{ products: Product[] }>(API, {
    cache: "no-store",
    signal,
  });
  return result.products;
}

export function fetchProductGroups(
  signal?: AbortSignal,
): Promise<ProductGroups> {
  return apiFetch<ProductGroups>(`${API}/groups`, {
    cache: "no-store",
    signal,
  });
}

// ── Groups（后端 2026-10-11 `85a5d95`，Annie：新建 / 改名 / 排序 / 停用；没有删除）──────────
// 规则全在后端（app/services/manifest_groups.py）：Short name 和分类建了以后不能改、显示名不分大小写不能重复，
// 不合规矩时 400 + 一句给 staff 看的英文，前端照原话显示，不自己再校验一遍。

/** 新建一个组。sort_order 不传 = 排最后。 */
export function createProductGroup(input: {
  name: string;
  display_name: string;
  booking_type: string;
  sort_order?: number;
  is_active: boolean;
}): Promise<ProductGroup> {
  return apiFetch<ProductGroup>(`${API}/groups`, {
    method: "POST",
    body: input,
  });
}

/** 改显示名 / 顺序 / 启用状态（一次改一项）。停用只影响「给产品选组」的下拉，组里的产品和客人照常显示。 */
export function updateProductGroup(
  id: number,
  patch: {
    display_name?: string;
    sort_order?: number | null;
    is_active?: boolean;
  },
): Promise<ProductGroup> {
  return apiFetch<ProductGroup>(`${API}/groups/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function fetchMissingProducts(
  signal?: AbortSignal,
): Promise<MissingProduct[]> {
  const result = await apiFetch<{ missing: MissingProduct[] }>(
    `${API}/missing`,
    { cache: "no-store", signal },
  );
  return result.missing;
}

export const PRODUCT_LOG_LIMIT = 50;

export async function fetchProductLog(
  signal?: AbortSignal,
): Promise<ProductLogEntry[]> {
  const result = await apiFetch<{ entries: ProductLogEntry[] }>(`${API}/log`, {
    cache: "no-store",
    signal,
    query: { limit: PRODUCT_LOG_LIMIT },
  });
  return result.entries;
}

export function createProduct(
  input: ProductCreateInput,
): Promise<{ id: number; product_code: string }> {
  return apiFetch(API, { method: "POST", body: input });
}

export async function updateProduct(
  id: number,
  input: ProductUpdateInput,
): Promise<void> {
  await apiFetch(`${API}/${id}`, { method: "PUT", body: input });
}

export function bulkUpdateProducts(
  input: ProductBulkInput,
): Promise<ProductBulkResult> {
  return apiFetch<ProductBulkResult>(`${API}/bulk`, {
    method: "PATCH",
    body: input,
  });
}

/**
 * 门票产品的 tour type（null = 清空）。单独的接口，⚠️ 不放进上面整体覆盖的 PUT：
 * PUT 不带这个键，放进去会被悄悄清空（后端契约 E）。产品分类不是 ticket、键不认识时 400。
 */
export function setProductTourType(
  id: number,
  ticketTourType: string | null,
): Promise<{ success: boolean; ticket_tour_type: string | null }> {
  return apiFetch(`${API}/${id}/tour-type`, {
    method: "PATCH",
    body: { ticket_tour_type: ticketTourType },
  });
}

export async function setProductActive(
  id: number,
  active: boolean,
): Promise<void> {
  await apiFetch(`${API}/${id}/active`, { method: "PATCH", body: { active } });
}

// ── Manifest setup（印出来的巴士 manifest 长什么样）─────────────────────────

const SETUP_API = "/api/settings/manifest-setup";

export function fetchManifestSetup(
  signal?: AbortSignal,
): Promise<ManifestSetup> {
  return apiFetch<ManifestSetup>(SETUP_API, { cache: "no-store", signal });
}

/**
 * 顶栏颜色（空串 = 默认灰）、午餐单那一行（空 = 不印午餐单）、Guests per bus。
 * `guests_per_bus` 不传 = 不改；传输入框原文，后端校验 1–99（不合规矩 400，写原因）。
 */
export function saveManifestGroup(
  manifestId: number,
  input: { color: string; lunch_note: string; guests_per_bus?: string },
): Promise<{
  manifest_color: string | null;
  manifest_lunch_note: string;
  guests_per_bus: number;
}> {
  return apiFetch(`${SETUP_API}/groups/${manifestId}`, {
    method: "PUT",
    body: input,
  });
}

/** 整组替换 60 天 Forecast 上单独成块的节（后端去空项、查重名、不能是默认节、最多 6 个）。 */
export function saveForecastSplitSections(
  manifestId: number,
  sections: string[],
): Promise<{ sections: string[] }> {
  return apiFetch(`${SETUP_API}/groups/${manifestId}/forecast-split-sections`, {
    method: "PUT",
    body: { sections },
  });
}

/**
 * 整组替换这个团的 Extra（后端 2026-10-12 `ad8b7ab`）：新的不带 id；没送回来的删掉（挂着它的产品变回普通 Tour）。
 * 名字 1–40 字、同团不分大小写不能重名，座位 1–999 必填；seats 按输入框原样传，由后端校验，不合规矩 400 + 原话。
 * （原来的 `…/counters` 接口已经拿掉。）
 */
export function saveManifestExtras(
  manifestId: number,
  extras: { id?: number; name: string; seats: string }[],
): Promise<{ extras: ManifestExtra[] }> {
  return apiFetch(`${SETUP_API}/groups/${manifestId}/extras`, {
    method: "PUT",
    body: { extras },
  });
}

/**
 * 产品的节和类型。extra_id：不传 = 不改，null = 去掉；只有 kind tour 的产品能挂 Extra。
 * return_pickup_time / place（G36，往返 shuttle 的回程）：不传 = 不改；最长 20 / 80 字。
 */
export function saveManifestSection(
  productId: number,
  input: {
    section: string;
    kind: ManifestSectionKind;
    extra_id?: number | null;
    return_pickup_time?: string;
    return_pickup_place?: string;
  },
): Promise<{
  section: string;
  kind: ManifestSectionKind;
  extra_id: number | null;
  return_pickup_time: string;
  return_pickup_place: string;
}> {
  return apiFetch(`${SETUP_API}/products/${productId}`, {
    method: "PUT",
    body: input,
  });
}
