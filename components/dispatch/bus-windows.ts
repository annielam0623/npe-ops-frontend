import type { DispatchRow, DispatchSection } from "@/types";

import { cloneRow, META } from "./config";

/**
 * 按人数开车窗（待办 G29 第 3 条，Annie 2026-10-05；`openWindows()` / `notNeededRows()` 照旧页面 dispatch_assignments.html 搬）。
 * 每个巴士团开 ceil(人数 / 每车几位) 台车（服务端算好的 `buses_needed`，随 Step 1 的卡片来）。
 * 每车几位只决定开几台，跟最后排哪辆车、几座无关。没传名单不开。补开的车**不保存**（自动保存也不存它们，重读后按人数再开）。
 *
 * ⚠️ 和旧页面不同（Annie 2026-10-11）：**名单一到就补开，不等 CCL**。CCL 的排车只是确认——它来了以后把司机、车填进前几台；
 * CCL 只给了一台而人数要两台时，多出来的那台留空，staff 去安排 farm out（docs/farm-out/任务包_farm-out.md）。
 * 所以「只有补开的空车」不算动过手：CCL 照样预填（见 `withoutAutoWindows`）。
 *
 * 🚨 2026-10-16 Annie 紧急定（取代上面「服务端算好的 buses_needed」，不等 preview）：
 * 已经选了车的那几台，要看**这台车在 Vehicles 里填的座位数**坐不坐得下，不能只看 guests_per_bus 瞎开。
 * 例：Antelope 59 人，Bus A 选了 1960（59 座）明明够坐，旧算法 ceil(59/54)=2 一直冒出 Bus B。
 * 新算法见 `computeNeeded()`；用的是**页面上当前选的车**（哪怕还没点 Save），不等保存 / 刷新。
 * 后端 -84 在改服务端同一条（只看已保存的车），前端这边独立现算，两边口径一致、互不依赖。
 */
export interface TourNeed {
  needed: number;
  pax: number;
  /** 每台车（字母）现在坐了几位。 */
  bus_pax: Record<string, number>;
  /**
   * 这个团每车几位（后端算 `needed` 用的同一个数）。没有 = 旧接口，前端不现算，`needed` 照服务端给的用。
   */
  guests_per_bus?: number;
}

/**
 * 要几台车：已排的车按座位数（填了几位算几位，没填退回 guestsPerBus）从大到小累加，够了就停；
 * 全部加完还不够，剩下的人再按 guestsPerBus 补（排了车时这样算出来的数最少是 1，不用另外兜底）；
 * 一台车都没排 ⇒ ceil(pax / guestsPerBus)，pax=0 时就是 0（跟原来一样，不额外兜底成 1）；
 * 没有 guests_per_bus（旧接口）⇒ 退回服务端给的 needed。和后端 -84 的口径对过，一致。
 */
function computeNeeded(n: TourNeed, capacities: number[]): number {
  const gpb = n.guests_per_bus;
  if (!gpb) return n.needed;
  if (!capacities.length) return Math.ceil(n.pax / gpb);
  const sorted = [...capacities].sort((a, b) => b - a);
  let covered = 0;
  for (let i = 0; i < sorted.length; i++) {
    covered += sorted[i];
    if (covered >= n.pax) return i + 1;
  }
  return sorted.length + Math.ceil((n.pax - covered) / gpb);
}

/** 已排的车，每台的容量（填了座位数就用它，没填退回 guests_per_bus）。 */
function assignedCapacities(
  mine: DispatchRow[],
  gpb: number | undefined,
  vehicleSeats: (id: number | null) => number | null,
): number[] {
  if (!gpb) return [];
  return mine.map((r) => vehicleSeats(r.vehicle_id) ?? gpb);
}

/**
 * 车不够就补开，返回新的整天的行；不用改就返回 null。
 * 要两台以上时每台都要有字母（客人按字母分车）：已有的车没字母就按顺序编上，新开的接着往下编。
 * CCL 关了的团不补；字母只有 bus_labels 那几个，最多开那么多台。
 */
export function openWindows(
  rows: DispatchRow[],
  sections: DispatchSection[],
  need: Record<number, TourNeed>,
  isClosed: (s: DispatchSection) => boolean,
  defaultStops: (shift: string, tour: number | null) => number[],
  vehicleSeats: (id: number | null) => number | null,
): DispatchRow[] | null {
  const labels = META.bus_labels;
  let next: DispatchRow[] | null = null;
  for (const s of sections) {
    if (s.shift !== META.bus_tour_shift || s.manifest_id == null) continue;
    const n = need[s.manifest_id];
    if (!n || isClosed(s)) continue;
    const cur: DispatchRow[] = next ?? rows;
    const mine = cur.filter(
      (r) => r.shift === META.bus_tour_shift && r.manifest_id === s.manifest_id,
    );
    const needed = computeNeeded(
      n,
      assignedCapacities(mine, n.guests_per_bus, vehicleSeats),
    );
    if (!needed) continue;
    const want = Math.min(needed, labels.length);
    if (mine.length >= want) continue;
    const used = new Set(
      mine.flatMap((r) => (r.bus_label ? [r.bus_label] : [])),
    );
    const nextLetter = () => {
      const l = labels.find((x) => !used.has(x)) ?? null;
      if (l) used.add(l);
      return l;
    };
    const lettered = new Map<DispatchRow, DispatchRow>();
    if (want >= 2) {
      for (const r of mine)
        if (!r.bus_label) lettered.set(r, { ...r, bus_label: nextLetter() });
    }
    const added: DispatchRow[] = [];
    for (let i = mine.length; i < want; i++) {
      added.push(
        cloneRow({
          shift: META.bus_tour_shift,
          manifest_id: s.manifest_id,
          bus_label: want >= 2 ? nextLetter() : null,
          location_ids: defaultStops(META.bus_tour_shift, s.manifest_id),
        }),
      );
    }
    next = [...cur.map((r) => lettered.get(r) ?? r), ...added];
  }
  return next;
}

/**
 * 这个团的人数用不着的车：{行下标: 这台车坐了几位}。排在「要几台」之后的那几台标黄，**不自动删**。
 * 排序不能纯按字母（staff 挪过订单后，坐了人的可能是字母靠后的那台）：坐了人的排前面（留着），没人的排后面（先标黄）；
 * 都坐了人 / 都没人时字母靠前的留着。
 */
export function notNeededRows(
  rows: DispatchRow[],
  manifestId: number | null,
  need: Record<number, TourNeed>,
  vehicleSeats: (id: number | null) => number | null,
): Map<number, number> {
  const out = new Map<number, number>();
  if (manifestId == null) return out;
  const n = need[manifestId];
  if (!n) return out;
  const paxOf = (i: number) => n.bus_pax[rows[i].bus_label ?? ""] ?? 0;
  const mine = rows.flatMap((r, i) =>
    r.shift === META.bus_tour_shift && r.manifest_id === manifestId ? [i] : [],
  );
  const needed = computeNeeded(
    n,
    assignedCapacities(
      mine.map((i) => rows[i]),
      n.guests_per_bus,
      vehicleSeats,
    ),
  );
  mine.sort((a, b) => {
    const pa = paxOf(a) > 0;
    const pb = paxOf(b) > 0;
    if (pa !== pb) return pa ? -1 : 1;
    const la = rows[a].bus_label ?? "~";
    const lb = rows[b].bus_label ?? "~";
    return la < lb ? -1 : la > lb ? 1 : a - b;
  });
  for (const i of mine.slice(needed)) out.set(i, paxOf(i));
  return out;
}

/** 补开出来、还没人动过的空车：没存过、没司机 / 导游 / 车 / 备注 / CCL。 */
export function isAutoWindow(r: DispatchRow): boolean {
  return (
    r.id == null &&
    r.shift === META.bus_tour_shift &&
    !r.driver_hr_id &&
    !r.driver_typed_name &&
    !r.vehicle_id &&
    !r.guide_hr_id &&
    !r.guide_typed_name &&
    !r.custom_tour_name &&
    !r.note &&
    !r.ccl
  );
}

/** 去掉补开的空车：判断「staff 动没动过手」、CCL 能不能预填时用。 */
export function withoutAutoWindows(rows: DispatchRow[]): DispatchRow[] {
  return rows.filter((r) => !isAutoWindow(r));
}
