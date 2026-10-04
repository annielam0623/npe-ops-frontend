import type { MissingProduct, Product, ProductGroup } from "@/types";

/** 分类的显示名；有哪些分类由后端下发，这里只管叫法，没有标签的照原值显示。 */
const TYPE_LABELS: Record<string, string> = {
  bus_tour: "Bus Tour",
  shuttle: "Shuttle",
  ticket: "Ticket",
  unmapped: "Unmapped",
};

export function typeLabel(type: string | null | undefined): string {
  return type ? (TYPE_LABELS[type] ?? type) : "";
}

export function groupLabel(group: ProductGroup): string {
  return `${group.display_name || group.name}${group.is_active ? "" : " (inactive)"}`;
}

/** 启用中、还没分类的（订单会落回自己存的值）。 */
export function needsCategory(p: Product): boolean {
  return p.is_active && !p.booking_type;
}

/** 搜索：代码 + Rezdy 名 + 内部名 + 组名，不分大小写。 */
export function matchesSearch(p: Product, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [p.product_code, p.product_name, p.internal_name, p.group_name]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export interface ProductSection {
  key: string;
  title: string;
  /** 这一组的全部商品数（不受筛选影响，同旧页面）。 */
  total: number;
  rows: Product[];
}

/** 后端已按组排好序；按组切段，筛选后没有行的组不显示。 */
export function groupSections(
  all: Product[],
  visible: Set<number>,
): ProductSection[] {
  const sections: ProductSection[] = [];
  for (const p of all) {
    const key = p.manifest_id === null ? "none" : String(p.manifest_id);
    let section = sections.find((s) => s.key === key);
    if (!section) {
      section = { key, title: p.group_name || "No group", total: 0, rows: [] };
      sections.push(section);
    }
    section.total += 1;
    if (visible.has(p.id)) {
      section.rows.push(p);
    }
  }
  return sections.filter((s) => s.rows.length > 0);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-01-05" → "Jan 5, 2026"（按 UTC 解析和格式化，不会偏一天）。 */
export function formatYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) {
    return ymd;
  }
  return DATE_FORMAT.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

export function missingDates(m: MissingProduct): string {
  if (!m.first_date) return "";
  return m.first_date === m.last_date
    ? formatYmd(m.first_date)
    : `${formatYmd(m.first_date)} – ${formatYmd(m.last_date)}`;
}
