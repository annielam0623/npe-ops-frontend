/**
 * CCL 去掉的车留着、整张卡标红（Annie 2026-11-27「Q1选B，Q2选A，动手」；preview docs/previews/ccl-removed）。
 * 后端 32 的字段名都只在这里和 types 里出现，改名只改这一处：
 * - 改版 changes 里 removed 带 `kept: true`（+ `reason`）⇒ Apply 不删、标红；旧后端不带 ⇒ 照旧删（G300 有备注的照旧留）。
 * - 车行 `ccl_removed: true`：Save 时存，GET 带回，重开照样红。
 * - driver-notice / guide-notice 带 `ccl_removed[]`：有 ⇒ Send texts now 灰掉；send 时后端回 400 `CCL_REMOVED`。
 */
import type { DispatchChange, DispatchRow } from "@/types";

export const CCL_REMOVED_CODE = "CCL_REMOVED";

/** driver-notice / guide-notice 里一台还没处理的车。 */
export interface CclRemovedCar {
  shift: string;
  /** 团名（Morning Relay 等没有团 = null）。 */
  tour: string | null;
  bus_label: string | null;
  /** 司机名（没有 = null）。 */
  driver?: string | null;
  van: string | null;
}

type Removed = Extract<DispatchChange, { kind: "removed" }>;

/** 这条 removed 按新规矩留着标红（后端 32 才带 kept）。 */
export function keepsRemovedRed(c: Removed): boolean {
  return c.kept === true;
}

export function isCclRemoved(r: DispatchRow): boolean {
  return r.ccl_removed === true;
}

/** 保存时送回的键：undefined 不带（旧后端），有了原样送回。 */
export function cclRemovedPayload(r: DispatchRow): { ccl_removed?: boolean } {
  return r.ccl_removed === undefined ? {} : { ccl_removed: r.ccl_removed };
}

/**
 * staff 换了车号的红卡：红消失（Annie「把车删掉或改其它车」）。只改司机 / 导游 / 酒店 / Bus 字母照旧红。
 * 删车不用管（行没了）。
 */
export function clearOnVehicleChange(
  prev: DispatchRow[],
  next: DispatchRow[],
): DispatchRow[] {
  const old = new Map(
    prev.filter((r) => r.id != null && isCclRemoved(r)).map((r) => [r.id, r]),
  );
  if (!old.size) return next;
  return next.map((r) => {
    if (!isCclRemoved(r) || r.id == null) return r;
    const o = old.get(r.id);
    return o && o.vehicle_id !== r.vehicle_id
      ? { ...r, ccl_removed: false }
      : r;
  });
}

/** Send 红框里一台车的写法：「Bus B (West Rim) · GIA · 2056」。 */
export function cclRemovedCarText(c: CclRemovedCar): string {
  const who = c.bus_label ? `Bus ${c.bus_label}` : `vehicle ${c.van ?? "-"}`;
  return [
    `${who} (${c.tour || c.shift})`,
    c.driver || null,
    c.bus_label ? c.van : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function cclRemovedSendText(n: number): string {
  return `Can’t send yet: CCL removed ${n} vehicle${n === 1 ? "" : "s"}. Remove ${n === 1 ? "it" : "them"} or change ${n === 1 ? "it" : "them"} to another vehicle on the Assign tab, Save, then Refresh.`;
}
