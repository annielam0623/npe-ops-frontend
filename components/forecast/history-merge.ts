import type { Forecast60Day } from "@/types";

/**
 * PREVIEW：把过去几天接到今天这张表的左边。每个过去的日子取那天自己的快照（当晚 23:55 存的）的第 0 列，
 * 今天和以后的格子照旧用实时数据。past 按日期从早到晚。
 * 做法：实时数据里凡是长度 = days 的数组（各行的 60 天数字、格子、导游……），前面接上每张快照同一路径的第 0 个。
 */
export function mergePastDays(
  live: Forecast60Day,
  past: { date: string; forecast: Forecast60Day }[],
): Forecast60Day {
  const cut = Math.max(0, live.days.indexOf(live.today));
  const n = live.days.length;

  function walk(liveVal: unknown, snapVals: unknown[]): unknown {
    if (Array.isArray(liveVal)) {
      if (liveVal.length !== n) return liveVal;
      return [
        ...snapVals.map((s) => (Array.isArray(s) ? s[0] : undefined)),
        ...liveVal.slice(cut),
      ];
    }
    if (liveVal && typeof liveVal === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(liveVal)) {
        out[k] = walk(
          v,
          snapVals.map((s) =>
            s && typeof s === "object"
              ? (s as Record<string, unknown>)[k]
              : undefined,
          ),
        );
      }
      return out;
    }
    return liveVal;
  }

  const blocks = live.blocks.map((block) => {
    const snaps = past.map((p) =>
      p.forecast.blocks.find(
        (b) =>
          b.manifest_id === block.manifest_id && b.section === block.section,
      ),
    );
    return walk(block, snaps) as typeof block;
  });

  return {
    ...live,
    days: [...past.map((p) => p.date), ...live.days.slice(cut)],
    blocks,
    page_cells: walk(
      live.page_cells,
      past.map((p) => p.forecast.page_cells),
    ) as Forecast60Day["page_cells"],
    page_cells_meta: walk(
      live.page_cells_meta,
      past.map((p) => p.forecast.page_cells_meta),
    ) as Forecast60Day["page_cells_meta"],
    ccl_other: Object.assign(
      {},
      ...past.map((p) => ({ [p.date]: p.forecast.ccl_other[p.date] ?? [] })),
      live.ccl_other,
    ),
  };
}
