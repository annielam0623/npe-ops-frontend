import { apiFetch } from "@/lib/api-client";
import { isStatus } from "@/lib/api-errors";

/**
 * Settings → Products 的 Categories（booking_type）。Category 原来是后端写死的四个（bus_tour / ticket / shuttle / unmapped，
 * 随 `GET /api/settings/products/groups` 的 `booking_types` 下发），Annie 2026-10-19：「你需要给一个地方专门用来增加新的 category」。
 * 后端接口还没有（G141，2026-10-19，后端明天评估）：下面是 ops 按 preview 先写的草案，等后端草案到了只改这个文件。
 * 接口没上线（404 / 返回里没有 categories）时 fetchCategories 返回 null，页面整张 Categories 卡不显示、其余不受影响。
 *
 * 规矩同 Groups（后端要保证）：Short name 建了不能改、Name 不能重复（不分大小写）、没有删除、只有 admin 能建、
 * 停用只是不出现在各个 Category 下拉里（已经用着它的产品和组不变）；四个内置的不能停用。
 * 「新 Category 默认不发送、不进 Manifest / Dispatch / auto send，只用于统计」也由后端保证，前端不处理。
 */
const API = "/api/settings/products/categories";

export interface ProductCategory {
  /** booking_type 的值（Short name），建了不能改。 */
  key: string;
  /** 显示名（下拉和表里写的）。 */
  name: string;
  is_builtin: boolean;
  is_active: boolean;
}

/** 分类清单；接口没上线返回 null。其他错误（含 401）照常抛出。 */
export async function fetchCategories(
  signal?: AbortSignal,
): Promise<ProductCategory[] | null> {
  try {
    const result = await apiFetch<{ categories?: ProductCategory[] }>(API, {
      cache: "no-store",
      signal,
    });
    return Array.isArray(result?.categories) ? result.categories : null;
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

/** 新建。Short name 唯一、Name 不分大小写不能重复，不合规矩时 400 + 一句给 staff 看的英文。 */
export function createCategory(input: {
  key: string;
  name: string;
}): Promise<ProductCategory> {
  return apiFetch<ProductCategory>(API, { method: "POST", body: input });
}

/** 停用 / 重新启用（内置的不能停用，后端 400）。 */
export function setCategoryActive(
  key: string,
  active: boolean,
): Promise<ProductCategory> {
  return apiFetch<ProductCategory>(`${API}/${encodeURIComponent(key)}/active`, {
    method: "PATCH",
    body: { active },
  });
}
