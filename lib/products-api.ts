import { apiFetch } from "@/lib/api-client";
import type {
  ManifestCounter,
  ManifestSectionKind,
  ManifestSetup,
  MissingProduct,
  Product,
  ProductBulkInput,
  ProductBulkResult,
  ProductCreateInput,
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

/** 顶栏颜色（空串 = 默认灰）和午餐单那一行（空 = 不印午餐单）。 */
export function saveManifestGroup(
  manifestId: number,
  input: { color: string; lunch_note: string },
): Promise<{ manifest_color: string | null; manifest_lunch_note: string }> {
  return apiFetch(`${SETUP_API}/groups/${manifestId}`, {
    method: "PUT",
    body: input,
  });
}

/** 整组替换 manifest 底部的计数框。 */
export function saveManifestCounters(
  manifestId: number,
  // seats 按输入框原样传（字符串），由后端解析和校验。
  counters: { label: string; match_text: string; seats: string | null }[],
): Promise<{ counters: ManifestCounter[] }> {
  return apiFetch(`${SETUP_API}/groups/${manifestId}/counters`, {
    method: "PUT",
    body: { counters },
  });
}

export function saveManifestSection(
  productId: number,
  input: { section: string; kind: ManifestSectionKind },
): Promise<{ section: string; kind: ManifestSectionKind }> {
  return apiFetch(`${SETUP_API}/products/${productId}`, {
    method: "PUT",
    body: input,
  });
}
