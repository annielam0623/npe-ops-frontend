import type { ManifestSetup, Product } from "@/types";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Products 页非门票产品的 Tour type 那一格（只读，后端 G130，Annie「按节」）：显示这个产品所在节的默认 tour type。
 * 后端产品列表里的 bus_tour_type 是没人读的旧列，所以按 manifest-setup 接口自己对：
 * 产品所属团 + 节名（(manifest_id, manifest_section)，空串 = 主块，忽略大小写和首尾空白）。
 * 返回：undefined = 还没读到 manifest-setup；"" = 没设 / 班车 / 没分团（页面写 —）；否则是 tour type 的显示名。
 */
export function sectionTourTypeLabel(
  setup: ManifestSetup | null,
  product: Product,
): string | undefined {
  if (!setup) return undefined;
  const group = setup.groups.find((g) =>
    g.products.some((p) => p.id === product.id),
  );
  const sp = group?.products.find((p) => p.id === product.id);
  // 班车永远没有节默认值（后端 Safety rule；旧列里的手填值不显示）。
  if (!group || !sp || sp.manifest_section_kind !== "tour") return "";
  const entry = group.section_tour_types?.find(
    (e) => norm(e.section) === norm(sp.manifest_section),
  );
  if (!entry?.tour_type) return "";
  return (
    setup.tour_types?.find((t) => t.key === entry.tour_type)?.label ??
    entry.tour_type
  );
}
