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
 * 不是按天的数组（块里的细行 rows、上限行 allotments……）也要往里走：每个元素按 label（+ kind）去快照里找同一行，
 * 找不到再按位置（Annie 2026-11-11「只是每个tour的header move了，内容没有跟着动」：以前这种数组原样跳过，
 * 细行的数字一直是今天的）。
 * forecast = null（那天没存快照）：先拿今天那一列垫着保证格子能画，表格按 noSnapshotDays 整列显示「—」。
 * 那天有快照、但快照里没有这一块 / 这一行（那天还没这条线、那天没人订）：数字 0、文字空、其余 null，不拿今天的数垫。
 */
export function mergePastDays(
  live: Forecast60Day,
  past: { date: string; forecast: Forecast60Day | null }[],
): Forecast60Day {
  const cut = Math.max(0, live.days.indexOf(live.today));
  const n = live.days.length;
  /** 快照存在、但里面没有这一项。和 undefined（那天没快照）分开。 */
  const MISSING = Symbol("missing");

  function emptyLike(v: unknown): unknown {
    if (typeof v === "number") return 0;
    if (typeof v === "string") return "";
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) return [];
    // 按天的对象（Driver / Guide 那一天）：结构照留、里面清空，格子才画得出来。
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, emptyLike(x)]),
      );
    return null;
  }

  /** 快照里和 liveEl 对应的那一项：有 label 的按 label（+ kind）认，否则按位置。 */
  function pick(snapArr: unknown, liveEl: unknown, i: number): unknown {
    if (snapArr === undefined) return undefined;
    if (!Array.isArray(snapArr)) return MISSING;
    const key = liveEl as { label?: unknown; kind?: unknown } | null;
    if (key && typeof key === "object" && typeof key.label === "string") {
      const hit = snapArr.find(
        (s) =>
          s &&
          typeof s === "object" &&
          (s as { label?: unknown }).label === key.label &&
          (key.kind === undefined ||
            (s as { kind?: unknown }).kind === key.kind),
      );
      return hit === undefined ? MISSING : hit;
    }
    return i < snapArr.length ? snapArr[i] : MISSING;
  }

  function walk(liveVal: unknown, snapVals: unknown[]): unknown {
    if (Array.isArray(liveVal)) {
      if (liveVal.length !== n) {
        // 不按天的数组：只有元素是对象（细行、上限行）才往里走；字符串等原样。
        return liveVal.map((el, i) =>
          el && typeof el === "object"
            ? walk(
                el,
                snapVals.map((s) => (s === MISSING ? MISSING : pick(s, el, i))),
              )
            : el,
        );
      }
      return [
        ...snapVals.map((s) =>
          s === MISSING
            ? emptyLike(liveVal[cut])
            : Array.isArray(s) && s.length
              ? s[0]
              : s === undefined
                ? liveVal[cut]
                : emptyLike(liveVal[cut]),
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
            s === MISSING
              ? MISSING
              : s && typeof s === "object"
                ? ((s as Record<string, unknown>)[k] ?? MISSING)
                : s === undefined
                  ? undefined
                  : MISSING,
          ),
        );
      }
      return out;
    }
    return liveVal;
  }

  const blocks = live.blocks.map((block) => {
    // 那天没快照 = undefined；有快照但那天还没这一块 = MISSING（数字 0，不拿今天的垫）。
    const snaps = past.map((p) =>
      p.forecast
        ? (p.forecast.blocks.find(
            (b) =>
              b.manifest_id === block.manifest_id &&
              b.section === block.section,
          ) ?? MISSING)
        : undefined,
    );
    return walk(block, snaps) as typeof block;
  });

  return {
    ...live,
    days: [...past.map((p) => p.date), ...live.days.slice(cut)],
    blocks,
    page_cells: walk(
      live.page_cells,
      past.map((p) =>
        p.forecast ? (p.forecast.page_cells ?? MISSING) : undefined,
      ),
    ) as Forecast60Day["page_cells"],
    page_cells_meta: walk(
      live.page_cells_meta,
      past.map((p) =>
        p.forecast ? (p.forecast.page_cells_meta ?? MISSING) : undefined,
      ),
    ) as Forecast60Day["page_cells_meta"],
    ccl_other: Object.assign(
      {},
      ...past.map((p) => ({ [p.date]: p.forecast?.ccl_other[p.date] ?? [] })),
      live.ccl_other,
    ),
  };
}
