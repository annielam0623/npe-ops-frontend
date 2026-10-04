import type { DispatchDay, DispatchRow } from "@/types";

/**
 * 旧页面从 Jinja 拿的 7 个常量（`routers/dispatch.py` 页面路由），后端没有 JSON 接口 ⇒ 照抄一份。
 * ⚠️ 后端改了要同步（已记进 PROGRESS「需要后端」：请在 /api/dispatch/day 带出来）。
 */
export const COVERAGE_SHIFTS = ["relay", "relay_2"] as const;
export const RELAY_SHIFTS = ["relay", "relay_2"];
export const BUS_TOUR_SHIFT = "bus_tour";
export const SHIFT_ASSIGNMENT: Record<string, string> = {
  relay: "morning_relay",
  relay_2: "morning_relay",
  bus_tour: "bus_tour",
  private_tour: "private_tour",
};
export const ASSIGNMENT_LABELS: Record<string, string> = {
  morning_relay: "Morning Relay",
  bus_tour: "Bus Tour",
  private_tour: "Private Tour",
};
export const BUS_LABELS = ["A", "B", "C", "D", "E"];

/** 手填名字 / 团名的长度上限（同服务端 `_typed_text()`）。 */
export const NAME_MAX = 60;
export const TOUR_NAME_MAX = 100;

export function isRelay(shift: string): boolean {
  return RELAY_SHIFTS.includes(shift);
}

/** 一行车属于哪一块：团车按「班次 + 团」，其余按班次。 */
export function secOf(r: {
  shift: string;
  manifest_id: number | null;
}): string {
  return r.shift === BUS_TOUR_SHIFT ? `${r.shift}:${r.manifest_id}` : r.shift;
}

export function cloneRow(
  r: Partial<DispatchRow> & { shift: string },
): DispatchRow {
  return {
    id: r.id ?? null,
    shift: r.shift,
    driver_hr_id: r.driver_hr_id || null,
    vehicle_id: r.vehicle_id ?? null,
    manifest_id: r.manifest_id ?? null,
    guide_hr_id: r.guide_hr_id || null,
    bus_label: r.bus_label || null,
    driver_typed_name: r.driver_typed_name || null,
    guide_typed_name: r.guide_typed_name || null,
    custom_tour_name: r.custom_tour_name || null,
    note: r.note ?? "",
    location_ids: [...(r.location_ids ?? [])],
    driver_name: r.driver_name || null,
    guide_name: r.guide_name || null,
    ccl: r.ccl ?? null,
  };
}

export function cloneRows(rows: DispatchRow[]): DispatchRow[] {
  return rows.map(cloneRow);
}

/** 比较用的签名：显示用的名字、CCL 原文、id 不算；站点顺序不算。 */
export function rowKey(r: DispatchRow): string {
  return [
    r.shift,
    r.driver_hr_id,
    r.vehicle_id,
    r.manifest_id,
    r.guide_hr_id,
    r.bus_label,
    r.note,
    r.driver_typed_name,
    r.guide_typed_name,
    r.custom_tour_name,
    [...r.location_ids].sort((a, b) => a - b).join(","),
  ].join("|");
}

/** 「N unsaved changes」按行数、按内容配对（不按下标）。 */
export function countChanges(base: DispatchRow[], rows: DispatchRow[]): number {
  const pool = new Map<string, number>();
  for (const r of base) pool.set(rowKey(r), (pool.get(rowKey(r)) ?? 0) + 1);
  let now = 0;
  for (const r of rows) {
    const k = rowKey(r);
    const n = pool.get(k) ?? 0;
    if (n) pool.set(k, n - 1);
    else now++;
  }
  let before = 0;
  pool.forEach((n) => (before += n));
  return Math.max(now, before);
}

export function hasDriver(r: DispatchRow): boolean {
  return !!(r.driver_hr_id || r.driver_typed_name);
}

export function isDriverGuide(r: DispatchRow): boolean {
  return !!r.guide_hr_id && r.guide_hr_id === r.driver_hr_id;
}

export function canRun(d: { assignments: string[] }, shift: string): boolean {
  const a = d.assignments || [];
  return !a.length || a.includes(SHIFT_ASSIGNMENT[shift]);
}

// ── 日期：全程 'YYYY-MM-DD' 字符串，不碰 new Date(str)（按 UTC 解析会差一天） ──

const DOW = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MON = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Monday, October 5" */
export function fmtLong(iso: string): string {
  const p = parts(iso);
  return `${DOW[p.dow]}, ${MON[p.m - 1]} ${p.d}`;
}

/** "Mon, Oct 5" */
export function fmtShort(iso: string): string {
  const p = parts(iso);
  return `${DOW[p.dow].slice(0, 3)}, ${MON[p.m - 1].slice(0, 3)} ${p.d}`;
}

// ── 查表 ──

export type Lookup = ReturnType<typeof makeLookup>;

export function makeLookup(day: DispatchDay) {
  const drivers = new Map(day.drivers.map((d) => [d.id, d]));
  const vehicles = new Map(day.vehicles.map((v) => [v.id, v]));
  const locations = new Map(day.locations.map((l) => [l.id, l]));
  const guides = new Map(day.guides.map((g) => [g.id, g]));
  return {
    day,
    driver: (id: number | null) => (id ? (drivers.get(id) ?? null) : null),
    driverName: (id: number | null) =>
      id ? (drivers.get(id)?.name ?? "") : "",
    vehicle: (id: number | null) => (id ? (vehicles.get(id) ?? null) : null),
    locName: (id: number) => locations.get(id)?.name ?? "(removed hotel)",
    guide: (id: number | null) => (id ? (guides.get(id) ?? null) : null),
    /** 新加一台车时默认带的站点（返回新数组）。 */
    defaultStops: (shift: string, tourId: number | null) => [
      ...(day.sections.find(
        (s) => s.shift === shift && s.manifest_id === tourId,
      )?.default_location_ids ?? []),
    ],
  };
}

// ── 提示（只提示，不拦；判据同旧页面） ──

/** 同一块里这一行的司机还开了哪几台（别的）车。 */
export function alsoOnVans(
  rows: DispatchRow[],
  idx: number,
  L: Lookup,
): string[] {
  const row = rows[idx];
  if (!row.driver_hr_id) return [];
  const seen = new Set<number>();
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (i === idx || secOf(r) !== secOf(row)) return;
    if (r.driver_hr_id !== row.driver_hr_id) return;
    if (!r.vehicle_id || r.vehicle_id === row.vehicle_id) return;
    if (seen.has(r.vehicle_id)) return;
    seen.add(r.vehicle_id);
    out.push(
      L.vehicle(r.vehicle_id)?.van_no ?? "a vehicle no longer in the pool",
    );
  });
  return out;
}

/** 同一块里这台车还被谁开着（只数有名有姓的司机）。 */
export function alsoDriving(
  rows: DispatchRow[],
  idx: number,
  L: Lookup,
): string[] {
  const row = rows[idx];
  if (!row.vehicle_id) return [];
  const seen = new Set<number>();
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (i === idx || secOf(r) !== secOf(row)) return;
    if (r.vehicle_id !== row.vehicle_id) return;
    if (!r.driver_hr_id || r.driver_hr_id === row.driver_hr_id) return;
    if (seen.has(r.driver_hr_id)) return;
    seen.add(r.driver_hr_id);
    out.push(L.driverName(r.driver_hr_id) || "a driver no longer on the list");
  });
  return out;
}

/** 整行重复（同一块 + 同司机 + 同车）：{行下标: {key, n}}。 */
export function duplicateRows(
  rows: DispatchRow[],
): Map<number, { key: string; n: number }> {
  const key = (r: DispatchRow) =>
    `${secOf(r)}|${r.driver_hr_id}|${r.vehicle_id}`;
  const count = new Map<string, number>();
  for (const r of rows) {
    if (!r.driver_hr_id || !r.vehicle_id) continue;
    count.set(key(r), (count.get(key(r)) ?? 0) + 1);
  }
  const dup = new Map<number, { key: string; n: number }>();
  rows.forEach((r, i) => {
    if (!r.driver_hr_id || !r.vehicle_id) return;
    const n = count.get(key(r)) ?? 0;
    if (n > 1) dup.set(i, { key: key(r), n });
  });
  return dup;
}

export interface SectionStat {
  key: string;
  name: string;
  when: string;
  vans: number;
  hotels: number;
}

export interface RailIssue {
  title: string;
  detail: string;
  /** 点了滚到哪一行。 */
  idx?: number;
  /** 没排车的酒店名单（多于 4 家时收起）。 */
  names?: string[];
  namesKey?: string;
}

export interface Analysis {
  sections: SectionStat[];
  issues: RailIssue[];
  /** issue box 副标题用：跟右栏同一份。 */
  missingTitles: string[];
  coverage: { shift: string; covered: number; total: number }[];
  driversUsed: number;
  dup: Map<number, { key: string; n: number }>;
}

/** 右栏 Schedule check、顶部统计（同旧页面 render / renderRail 的口径）。 */
export function analyze(rows: DispatchRow[], L: Lookup): Analysis {
  const day = L.day;
  const sectionKey = (s: { shift: string; manifest_id: number | null }) =>
    secOf(s);
  const relayHotels: Record<string, Set<number>> = {};
  COVERAGE_SHIFTS.forEach((c) => (relayHotels[c] = new Set()));
  const usedDrivers = new Set<number>();
  const sections: SectionStat[] = day.sections.map((s) => {
    const key = sectionKey(s);
    const mine = rows.filter((r) => secOf(r) === key);
    const hotels = new Set<number>();
    for (const r of mine) {
      if (r.driver_hr_id) usedDrivers.add(r.driver_hr_id);
      for (const l of r.location_ids) {
        hotels.add(l);
        relayHotels[r.shift]?.add(l);
      }
    }
    return {
      key,
      name: s.title,
      when: s.sub,
      vans: mine.length,
      hotels: hotels.size,
    };
  });
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const blockName = (r: DispatchRow) => byKey.get(secOf(r))?.name || r.shift;
  const covName = (c: string) => byKey.get(c)?.name || "the relay round";
  const activeLocs = day.locations.filter((l) => l.active !== false);

  const issues: RailIssue[] = [];
  const noDrv = rows.flatMap((r, i) => (hasDriver(r) ? [] : [i]));
  if (noDrv.length) {
    issues.push({
      title:
        noDrv.length === 1
          ? "1 vehicle has no driver yet"
          : `${noDrv.length} vehicles have no driver yet`,
      detail: "This is the only thing here that stops the day being saved.",
      idx: noDrv[0],
    });
  }

  const missingTitles: string[] = [];
  COVERAGE_SHIFTS.forEach((c, i) => {
    if (i > 0 && !byKey.get(c)?.vans) return;
    const missing = activeLocs.filter((l) => !relayHotels[c].has(l.id));
    if (!missing.length) return;
    const title = `${missing.length} hotel${missing.length === 1 ? "" : "s"} with no ${covName(c)} vehicle`;
    missingTitles.push(title);
    issues.push({
      title,
      detail: `Only ${covName(c)} counts here - each round is counted on its own, and the tours start from Treasure Island.`,
      names: missing.map((l) => l.name),
      namesKey: `missing:${c}`,
    });
  });

  const seen = new Set<string>();
  rows.forEach((row, idx) => {
    if (!row.driver_hr_id) return;
    const key = `${secOf(row)}:${row.driver_hr_id}`;
    if (seen.has(key)) return;
    const also = alsoOnVans(rows, idx, L);
    if (!also.length) return;
    const vans = [
      ...(row.vehicle_id
        ? [
            L.vehicle(row.vehicle_id)?.van_no ??
              "a vehicle no longer in the pool",
          ]
        : []),
      ...also,
    ];
    if (vans.length < 2) return;
    seen.add(key);
    issues.push({
      title: `${L.driverName(row.driver_hr_id) || "A driver no longer on the list"} is on ${vans.length} vehicles`,
      detail: `${blockName(row)} — ${vans.join(", ")}. Normal if they swap mid-run.`,
      idx,
    });
  });

  const seenVan = new Set<string>();
  rows.forEach((row, idx) => {
    if (!row.vehicle_id) return;
    const key = `${secOf(row)}:v${row.vehicle_id}`;
    if (seenVan.has(key)) return;
    const also = alsoDriving(rows, idx, L);
    if (!also.length) return;
    const names = [
      ...(row.driver_hr_id
        ? [L.driverName(row.driver_hr_id) || "a driver no longer on the list"]
        : []),
      ...also,
    ];
    if (names.length < 2) return;
    seenVan.add(key);
    issues.push({
      title: `${L.vehicle(row.vehicle_id)?.van_no ?? "That vehicle"} has ${names.length} drivers`,
      detail: `${blockName(row)} — ${names.join(", ")}. Normal if they share the vehicle.`,
      idx,
    });
  });

  const dup = duplicateRows(rows);
  const dupSeen = new Set<string>();
  rows.forEach((row, idx) => {
    const d = dup.get(idx);
    if (!d || dupSeen.has(d.key)) return;
    dupSeen.add(d.key);
    const v = L.vehicle(row.vehicle_id);
    issues.push({
      title: `${L.driverName(row.driver_hr_id) || "A driver no longer on the list"} is on ${v ? `vehicle ${v.van_no}` : "the same vehicle"} ${d.n === 2 ? "twice" : `${d.n} times`}`,
      detail: `${blockName(row)} — ${d.n === 2 ? "two rows" : `${d.n} rows`} with the same driver and the same vehicle. Merge the hotels into one row unless this is deliberate.`,
      idx,
    });
  });

  const sharedSeen = new Set<string>();
  rows.forEach((row, idx) => {
    if (row.shift !== BUS_TOUR_SHIFT) return;
    for (const l of row.location_ids) {
      const k = `${secOf(row)}:h${l}`;
      if (sharedSeen.has(k)) continue;
      const who = rows
        .filter((r) => secOf(r) === secOf(row) && r.location_ids.includes(l))
        .map(
          (r) => L.driverName(r.driver_hr_id) || "a vehicle with no driver yet",
        );
      if (who.length < 2) continue;
      sharedSeen.add(k);
      issues.push({
        title: `${L.locName(l)} is on ${who.length} vehicles`,
        detail: `${blockName(row)} — ${who.join(", ")}. Fine if both buses really stop there.`,
        idx,
      });
    }
  });

  if (day.orphans.length) {
    const n = day.orphans.length;
    issues.push({
      title: `${n} vehicle${n === 1 ? "" : "s"} on this day cannot be shown`,
      detail:
        "They belong to a tour that no longer has its own section. Saving this day will be refused until that is sorted out - ask Annie.",
    });
  }

  const badLic = new Set<number>();
  rows.forEach((row, idx) => {
    const d = L.driver(row.driver_hr_id);
    if (!d || badLic.has(d.id)) return;
    if (d.license_state === "expired") {
      badLic.add(d.id);
      issues.push({
        title: `${d.name}’s license has expired`,
        detail: "Shown for information. It does not block saving.",
        idx,
      });
    } else if (d.license_state === "soon") {
      badLic.add(d.id);
      issues.push({
        title: `${d.name}’s license expires in ${d.license_days} days${d.license_blocked ? ", before this day" : ""}`,
        detail: d.license_blocked
          ? "Pick another driver. It does not block saving."
          : "",
        idx,
      });
    }
  });

  const noGps = new Set<number>();
  rows.forEach((row, idx) => {
    const v = L.vehicle(row.vehicle_id);
    if (!v || v.has_tracking || noGps.has(v.id)) return;
    noGps.add(v.id);
    issues.push({
      title: `${v.van_no} has no live GPS`,
      detail: "Guests on that vehicle won’t see the map.",
      idx,
    });
  });

  return {
    sections,
    issues,
    missingTitles,
    coverage: COVERAGE_SHIFTS.map((c) => ({
      shift: c,
      covered: activeLocs.filter((l) => relayHotels[c].has(l.id)).length,
      total: activeLocs.length,
    })),
    driversUsed: usedDrivers.size,
    dup,
  };
}

/** 这一天 CCL 预填后还有几个名字没对上（手填的不算）。 */
export function unmatchedNames(rows: DispatchRow[]): number {
  let miss = 0;
  for (const r of rows) {
    if (!hasDriver(r)) miss++;
    if (
      r.ccl &&
      r.ccl.guide_text &&
      !r.ccl.is_driver_guide &&
      !r.guide_hr_id &&
      !r.guide_typed_name
    )
      miss++;
  }
  return miss;
}
