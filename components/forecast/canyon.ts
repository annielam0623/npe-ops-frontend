import type {
  CanyonProduct,
  CanyonSnapshot,
  Forecast60Day,
  ForecastBlock,
} from "@/types";

/**
 * Antelope 剩余座位（后端快照，Annie 2026-10-16）：
 * 估算 = min(max(0, A0 −（现在销售数 − S0）), 总容量)，现在销售数取 60-day 里同一行同一天的值，不缓存。
 */
export type CanyonCell =
  | { kind: "seats"; value: number; level: "normal" | "low" | "full" }
  | { kind: "nodata" } // 拉过了但 Rezdy 没有 05:15 场次：不是 0，不是满团
  | { kind: "unsynced" }; // 这天还没拉过

/** 这个块里、这一档（allotments[].label）对应的快照产品。 */
export function canyonProductFor(
  snapshot: CanyonSnapshot | null,
  block: ForecastBlock,
  label: string,
): CanyonProduct | null {
  if (!snapshot) return null;
  return (
    snapshot.products.find(
      (p) =>
        p.forecast_row !== null &&
        p.forecast_row.manifest_id === block.manifest_id &&
        p.forecast_row.section === block.section &&
        p.forecast_row.row_label === label,
    ) ?? null
  );
}

/** 这个块有没有任何一档接了快照；有 ⇒ 整行改成「Seats left」。 */
export function blockHasCanyon(
  snapshot: CanyonSnapshot | null,
  block: ForecastBlock,
): boolean {
  return (block.allotments ?? []).some(
    (a) => canyonProductFor(snapshot, block, a.label) !== null,
  );
}

export function canyonCell(
  snapshot: CanyonSnapshot,
  product: CanyonProduct,
  block: ForecastBlock,
  data: Forecast60Day,
  dayIndex: number,
): CanyonCell {
  const date = data.days[dayIndex];
  const day = product.days.find((d) => d.date === date);
  if (!day || day.pulled_at === null) return { kind: "unsynced" };
  if (
    day.seats_available_at_pull === null ||
    day.sold_at_pull === null ||
    snapshot.never_synced
  ) {
    return { kind: "nodata" };
  }
  const row = block.rows.find(
    (r) => r.label === product.forecast_row?.row_label,
  );
  const soldNow = row?.values[dayIndex] ?? day.sold_at_pull;
  const raw = day.seats_available_at_pull - (soldNow - day.sold_at_pull);
  const capped = day.seats === null ? raw : Math.min(raw, day.seats);
  const value = Math.max(0, capped);
  const level =
    value === 0 ? "full" : value <= snapshot.low_max ? "low" : "normal";
  return { kind: "seats", value, level };
}
