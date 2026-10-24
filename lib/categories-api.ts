import { apiFetch } from "@/lib/api-client";
import type { ProductCategory } from "@/types";

/**
 * Settings → Products 的 Categories（booking_type）。后端 G141 已上线（booking_categories 表，migrate_v116）：
 * 清单随 `GET /api/settings/products/groups` 的 `categories`（全部含停用）和 `booking_types`（只含启用的 code）下发，
 * 没有单独的 GET；这里只有新建和启用 / 停用两个写接口。
 *
 * 规矩（后端保证，前端照服务端原话显示）：code 建了不能改（小写字母 / 数字 / 下划线、字母开头、2–20 个字符）、
 * display_name 不能改、没有删除、只有 admin；停用只是不出现在各个 Category 下拉里（已经用着它的产品和组不变）；
 * 四个内置的不能停用（400）。「新 Category 默认不发送」也由后端保证，前端不处理。
 */
const API = "/api/settings/products/categories";

/** 新建。code 不合规矩时 400 + 一句给 staff 看的英文。 */
export function createCategory(input: {
  code: string;
  display_name: string;
}): Promise<ProductCategory> {
  return apiFetch<ProductCategory>(API, { method: "POST", body: input });
}

/** 停用 / 重新启用（内置的不能停用，后端 400）。 */
export function setCategoryActive(
  code: string,
  active: boolean,
): Promise<ProductCategory> {
  return apiFetch<ProductCategory>(`${API}/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body: { is_active: active },
  });
}
