import type {
  BreakdownAgent,
  BreakdownMetric,
  BreakdownNode,
  BreakdownPeriod,
  BreakdownResponse,
} from "@/lib/sales-breakdown-api";

/** 三个指标的固定顺序（All three 的行 / 列顺序）。 */
export const ALL_METRICS: readonly BreakdownMetric[] = [
  "orders",
  "pax",
  "amount",
];

/** 每个指标一个节点；没取到（请求失败）或这个指标里没有这一行 = undefined。 */
export type Vals = Partial<Record<BreakdownMetric, BreakdownNode>>;

export interface MergedProduct {
  key: string;
  code: string;
  label: string;
  inProducts: boolean;
  vals: Vals;
}
export interface MergedSection {
  key: string;
  title: string;
  kind: string;
  vals: Vals;
  products: MergedProduct[];
}
export interface MergedGroup {
  key: string;
  name: string;
  hasSections: boolean;
  vals: Vals;
  sections: MergedSection[];
}
export interface Merged {
  periods: BreakdownPeriod[];
  groups: MergedGroup[];
  grand: Vals;
  byCategory: { code: string; label: string; vals: Vals }[];
}

/**
 * 把一到三次请求的结果按 Group / section / 产品码 对齐拼成一棵树。
 * 对齐策略：以各次返回的行的并集为行（停用且为 0 的隐藏规则按各指标算，三次的行可能不同）；
 * 哪个指标里没有这一行，那一格由显示层补 0。Orders 的各层数字原样用后端给的，不自己加。
 */
export function mergeBreakdowns(
  responses: Partial<Record<BreakdownMetric, BreakdownResponse>>,
): Merged | null {
  const metrics = ALL_METRICS.filter((m) => responses[m]);
  if (!metrics.length) return null;
  const periods = responses[metrics[0]]!.periods;

  const groups = new Map<string, MergedGroup>();
  const sections = new Map<string, MergedSection>();
  const products = new Map<string, MergedProduct>();

  for (const metric of metrics) {
    const res = responses[metric]!;
    for (const g of res.groups) {
      const gKey = g.group_id === null ? "none" : String(g.group_id);
      let mg = groups.get(gKey);
      if (!mg) {
        mg = {
          key: gKey,
          name: g.group_name,
          hasSections: g.has_sections,
          vals: {},
          sections: [],
        };
        groups.set(gKey, mg);
      }
      mg.vals[metric] = g;
      mg.hasSections = mg.hasSections || g.has_sections;
      for (const s of g.sections) {
        const sKey = `${gKey}|${s.title}|${s.kind}`;
        let ms = sections.get(sKey);
        if (!ms) {
          ms = {
            key: sKey,
            title: s.title,
            kind: s.kind,
            vals: {},
            products: [],
          };
          sections.set(sKey, ms);
          mg.sections.push(ms);
        }
        ms.vals[metric] = s;
        for (const p of s.products) {
          const pKey = `${sKey}|${p.product_code}|${p.label}`;
          let mp = products.get(pKey);
          if (!mp) {
            mp = {
              key: pKey,
              code: p.product_code,
              label: p.label,
              inProducts: p.in_products,
              vals: {},
            };
            products.set(pKey, mp);
            ms.products.push(mp);
          }
          mp.vals[metric] = p;
        }
      }
    }
  }

  // 没归组永远放最后一段（并集后可能不在最后）。
  const list = [...groups.values()];
  const ordered = [
    ...list.filter((g) => g.key !== "none"),
    ...list.filter((g) => g.key === "none"),
  ];

  const grand: Vals = {};
  const cats = new Map<string, { code: string; label: string; vals: Vals }>();
  for (const metric of metrics) {
    const res = responses[metric]!;
    grand[metric] = res.grand_total;
    for (const c of res.by_category) {
      let item = cats.get(c.code);
      if (!item) {
        item = { code: c.code, label: c.label, vals: {} };
        cats.set(c.code, item);
      }
      item.vals[metric] = c;
    }
  }
  return { periods, groups: ordered, grand, byCategory: [...cats.values()] };
}

/** 一个格子：没有这一行 = 0。 */
export function cellOf(node: BreakdownNode | undefined, key: string): number {
  return node?.data?.[key] ?? 0;
}
export function totalOf(node: BreakdownNode | undefined): number {
  return node?.total ?? 0;
}

/** 点开产品后，把一到三个指标的 agent 表按 agent 名对齐。 */
export interface MergedAgent {
  agent: string;
  vals: Vals;
}
export function mergeAgents(
  responses: Partial<
    Record<
      BreakdownMetric,
      { agents: BreakdownAgent[]; grand_total: BreakdownNode }
    >
  >,
): { agents: MergedAgent[]; grand: Vals } {
  const map = new Map<string, MergedAgent>();
  const grand: Vals = {};
  const metrics = ALL_METRICS.filter((m) => responses[m]);
  if (!metrics.length) return { agents: [], grand };
  for (const metric of metrics) {
    const res = responses[metric]!;
    grand[metric] = res.grand_total;
    for (const a of res.agents) {
      let item = map.get(a.agent);
      if (!item) {
        item = { agent: a.agent, vals: {} };
        map.set(a.agent, item);
      }
      item.vals[metric] = a;
    }
  }
  // 最后一个指标（有 $ 就是 $）从大到小。
  const sortBy = metrics[metrics.length - 1];
  const agents = [...map.values()].sort(
    (x, y) => totalOf(y.vals[sortBy]) - totalOf(x.vals[sortBy]),
  );
  return { agents, grand };
}
