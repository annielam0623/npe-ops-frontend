import type { Forecast60Day } from "@/types";

/** 最多往回接几天（Annie 2026-11-01「这张表就默认回溯7天。要看数据我们单独建其他表」）。 */
export const MAX_DAYS_BACK = 7;

/** 今天之前的 n 天，早的在前：daysBefore("2026-11-05", 2) → ["2026-11-03", "2026-11-04"]。 */
export function daysBefore(today: string, n: number): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) =>
    new Date(start - (n - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * 把过去几天接到今天这张表的左边（Annie 2026-11-01）。每个过去的日子取那天自己的快照（当晚 23:55 PT 存的）的第一列，
 * 今天和以后照旧用实时数据；实时数据里今天以前的列（如果有）不要。past 按日期从早到晚。
 * 做法：实时数据里凡是长度 = days 的数组（各行 60 天的数字、格子、导游……），前面接上每张快照同一路径的第一个。
 * forecast = null（那天没存快照）：先拿今天那一列垫着保证格子能画，表格按 noSnapshotDays 整列显示「—」。
 */
export function mergePastDays(
  live: Forecast60Day,
  past: { date: string; forecast: Forecast60Day | null }[],
): Forecast60Day {
  const cut = Math.max(0, live.days.indexOf(live.today));
  const n = live.days.length;

  function walk(liveVal: unknown, snapVals: unknown[]): unknown {
    if (Array.isArray(liveVal)) {
      if (liveVal.length !== n) return liveVal;
      return [
        ...snapVals.map((s) =>
          Array.isArray(s) && s.length ? s[0] : liveVal[cut],
        ),
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
      p.forecast?.blocks.find(
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
      past.map((p) => p.forecast?.page_cells),
    ) as Forecast60Day["page_cells"],
    page_cells_meta: walk(
      live.page_cells_meta,
      past.map((p) => p.forecast?.page_cells_meta),
    ) as Forecast60Day["page_cells_meta"],
    ccl_other: Object.assign(
      {},
      ...past.map((p) => ({ [p.date]: p.forecast?.ccl_other[p.date] ?? [] })),
      live.ccl_other,
    ),
  };
}
