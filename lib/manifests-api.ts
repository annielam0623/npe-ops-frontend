import { apiFetch } from "@/lib/api-client";
import type { ManifestCfmResult, ManifestPage, ManifestTabKey } from "@/types";

/**
 * Manifests（require_staff：所有 staff 都能进，司机 / 导游 403）。
 * 金额组由后端按角色挡：staff 的 catalog 里没有、请求了会落进 denied，前端不判断角色。
 */
export function fetchManifestPage(
  params: {
    date: string;
    tab: ManifestTabKey;
    /** 空串 = 让后端用本标签 A→Z 第一颗。 */
    pill: string;
    /** null = 用后端的默认列。 */
    fields: readonly string[] | null;
  },
  signal?: AbortSignal,
): Promise<ManifestPage> {
  return apiFetch<ManifestPage>("/api/manifests", {
    cache: "no-store",
    signal,
    query: {
      date: params.date,
      tab: params.tab,
      pill: params.pill || undefined,
      fields: params.fields?.length ? params.fields.join(",") : undefined,
    },
  });
}

/** staff 填确认号；空串 = 清空。这一单这一天这个产品在 Rezdy 不存在时 404。 */
export function saveManifestCfm(input: {
  order_number: string;
  product_code: string;
  tour_date: string;
  confirmation_no: string;
}): Promise<ManifestCfmResult> {
  return apiFetch<ManifestCfmResult>("/api/manifests/cfm", {
    method: "PUT",
    body: input,
  });
}
