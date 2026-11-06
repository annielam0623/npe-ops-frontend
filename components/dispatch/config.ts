import { LA_TIME_ZONE } from "@/lib/la-date";
import type {
  DispatchDay,
  DispatchMeta,
  DispatchRow,
  DispatchTourLocks,
} from "@/types";

/**
 * 排车页的 7 个常量：以 `GET /api/dispatch/day` 的 `meta` 为准（后端 `dispatch.page_meta()`，与旧页面模板同一份），
 * 每读一天就用 `applyDispatchMeta()` 换上。下面的值只在接口没带 `meta`（旧后端）时兜底。
 */
export const META: DispatchMeta = {
  coverage_shifts: ["relay", "relay_2"],
  round_names: { relay: "1st Round", relay_2: "2nd Round" },
  relay_shifts: ["relay", "relay_2"],
  bus_tour_shift: "bus_tour",
  shift_assignment: {
    relay: "morning_relay",
    relay_2: "morning_relay",
    bus_tour: "bus_tour",
    private_tour: "private_tour",
  },
  assignment_labels: {
    morning_relay: "Morning Relay",
    bus_tour: "Bus Tour",
    private_tour: "Private Tour",
  },
  bus_labels: ["A", "B", "C", "D", "E"],
};

/** 换上接口给的常量；缺的键、类型不对的键保留原值。 */
export function applyDispatchMeta(m: Partial<DispatchMeta> | undefined): void {
  if (!m || typeof m !== "object") return;
  const strList = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  const strMap = (v: unknown): v is Record<string, string> =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "string");
  if (strList(m.coverage_shifts)) META.coverage_shifts = [...m.coverage_shifts];
  if (strMap(m.round_names)) META.round_names = { ...m.round_names };
  if (strList(m.relay_shifts)) META.relay_shifts = [...m.relay_shifts];
  if (typeof m.bus_tour_shift === "string" && m.bus_tour_shift)
    META.bus_tour_shift = m.bus_tour_shift;
  if (strMap(m.shift_assignment))
    META.shift_assignment = { ...m.shift_assignment };
  if (strMap(m.assignment_labels))
    META.assignment_labels = { ...m.assignment_labels };
  if (strList(m.bus_labels)) META.bus_labels = [...m.bus_labels];
}

/** 手填名字 / 团名的长度上限（同服务端 `_typed_text()`）。 */
export const NAME_MAX = 60;
export const TOUR_NAME_MAX = 100;

export function isRelay(shift: string): boolean {
  return META.relay_shifts.includes(shift);
}

/** 一行车属于哪一块：团车按「班次 + 团」，其余按班次。 */
export function secOf(r: {
  shift: string;
  manifest_id: number | null;
}): string {
  return r.shift === META.bus_tour_shift
    ? `${r.shift}:${r.manifest_id}`
    : r.shift;
}

/**
 * 按单元保存的单元（后端 POST /api/dispatch/section 的 unit）：Morning Relay 一个（两轮一起）、
 * 每个巴士团一个、Private Tour 一个。
 */
export function unitOf(r: {
  shift: string;
  manifest_id: number | null;
}): string {
  if (isRelay(r.shift)) return "relay";
  if (r.shift === META.bus_tour_shift) return `tour:${r.manifest_id}`;
  return r.shift;
}

/**
 * G250 锁定（置顶 93，Annie「93：全按推荐，动手」，preview SgRWaBvRcTie4cTdziPjtD Q1–Q9 全 A）：
 * 一个团（按 manifest_id，巴士团和选了团的 Private 车）/ 一轮 Morning Relay 出发 1 小时后锁；过去的日子整天锁
 * （Private Custom 也锁）。没锁 / 后端没带 / 没团的 Private Custom（当天）⇒ null。
 */
export interface LockInfo {
  kind: "tour" | "round" | "day";
  departure: string | null;
  locks_at: string | null;
  /** Super Admin：照常能改，只提示。 */
  canEdit: boolean;
}

export function lockOf(
  locks: DispatchTourLocks | null | undefined,
  r: { shift: string; manifest_id: number | null },
): LockInfo | null {
  if (!locks) return null;
  const canEdit = locks.can_edit_locked === true;
  if (locks.past_day)
    return { kind: "day", departure: null, locks_at: null, canEdit };
  const e = isRelay(r.shift)
    ? locks.rounds?.[r.shift]
    : r.manifest_id != null
      ? locks.tours?.[String(r.manifest_id)]
      : undefined;
  if (!e?.locked) return null;
  return {
    kind: isRelay(r.shift) ? "round" : "tour",
    departure: e.departure,
    locks_at: e.locks_at,
    canEdit,
  };
}

/** 锁住、而且当前的人不能改（不是 Super Admin）。 */
export function lockedForMe(l: LockInfo | null): boolean {
  return !!l && !l.canEdit;
}

function laClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    timeZone: LA_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** 说明条原文（preview Q1 / Q2 / Q3；过去的日子用 40 转的两句）。 */
export function lockText(l: LockInfo): string {
  const tail = l.canEdit
    ? "You can still change it as a Super Admin."
    : "Only a Super Admin can change it.";
  if (l.kind === "day") return `This day is locked. ${tail}`;
  const at = laClock(l.locks_at);
  const dep = laClock(l.departure);
  const after =
    l.kind === "round" ? "1 hour after its tours left" : "1 hour after departure";
  if (!at || !dep) return `Locked ${after}. ${tail}`;
  return `Locked at ${at}, ${after} (${dep}). ${tail}`;
}

/** 后端锁定 409 的两句原话（dispatch_tour_lock.TOUR_LOCKED_MESSAGE / ROUND_LOCKED_MESSAGE）；别的 409（G71 编辑锁）不算。 */
export function isTourLockMessage(text: string): boolean {
  return (
    text.startsWith("This tour is locked") ||
    text.startsWith("This Morning Relay round is locked")
  );
}

/**
 * 还没排的车：没选车、也没有司机（停的酒店不算：+ Add vehicle 会带默认酒店）。
 * Copy 1st Round 只换掉这种车，排过车或司机的不盖掉。
 */
export function isBlankRow(r: DispatchRow): boolean {
  return !r.vehicle_id && !r.driver_hr_id && !r.driver_typed_name?.trim();
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
    ...(r.farm_out
      ? {
          farm_out: true,
          partner_id: r.partner_id ?? null,
          partner_name: r.partner_name ?? null,
        }
      : {}),
    // 后端没上线时这两个是 undefined，保存时不送（见 lib/dispatch-api postRows）。
    order_number: r.order_number,
    order_number_set_by_staff: r.order_number_set_by_staff,
    seat_adjustment: r.seat_adjustment,
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
    r.order_number ?? "",
    r.order_number_set_by_staff ? 1 : 0,
    r.seat_adjustment ?? 0,
    [...r.location_ids].sort((a, b) => a - b).join(","),
    r.farm_out ? `fo${r.partner_id ?? ""}` : "",
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

/** Farm out 车（G40）不要司机：算「有」，保存、Issues 都不再报没司机。 */
export function hasDriver(r: DispatchRow): boolean {
  return !!(r.farm_out || r.driver_hr_id || r.driver_typed_name);
}

export function isDriverGuide(r: DispatchRow): boolean {
  return !!r.guide_hr_id && r.guide_hr_id === r.driver_hr_id;
}

export function canRun(d: { assignments: string[] }, shift: string): boolean {
  const a = d.assignments || [];
  return !a.length || a.includes(META.shift_assignment[shift]);
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
  /** 点 Fix 滚到哪一行。 */
  idx?: number;
  /** 滚到那一行以后把光标放到哪一格（data-f）：缺司机 = driver。 */
  field?: string;
  /** 指不到某一行、只指得到某一块时：点 Fix 滚到这一块（data-sec）。 */
  sec?: string;
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
  /** 巴士团还没选 Shuttle 上车点：这个团第一台车的行号 → Shuttle 客人数（车上「Add hotel」右边出提示）。 */
  shuttleAsk: Map<number, number>;
}

/**
 * Shuttle 客人要不要提醒选上车点：看订单上车点（Annie 2026-11-05「是要看他们的上车点，也就是出发的location，
 * 只有这个location不属于vegas酒店，就要提醒」）。后端 G253 pickup_is_vegas：true（Vegas 酒店，如 TI）⇒ 不提醒；
 * false（外地 shuttle 站）、null（空 / OFFICE / 对不上）、旧后端没这个键 ⇒ 提醒（宁多不漏）。
 */
export function needsShuttlePickup(g: { pickup_is_vegas?: boolean | null }): boolean {
  return g.pickup_is_vegas !== true;
}

/** 右栏 Schedule check、顶部统计（同旧页面 render / renderRail 的口径）。 */
/**
 * shuttlePax：团（manifest_id）→ 当天 Bus manifest 里要在 Shuttle 站上车的 Shuttle 客人数
 * （Shuttle 节里上车点不是 Vegas 酒店的，见 needsShuttlePickup）；没读到的团不提醒。
 */
export function analyze(
  rows: DispatchRow[],
  L: Lookup,
  shuttlePax?: Record<number, number>,
): Analysis {
  const day = L.day;
  const sectionKey = (s: { shift: string; manifest_id: number | null }) =>
    secOf(s);
  const relayHotels: Record<string, Set<number>> = {};
  META.coverage_shifts.forEach((c) => (relayHotels[c] = new Set()));
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
  // Morning Relay 只接 Las Vegas 的酒店（Annie 2026-10-31「morning relay只放vegas的酒店，shuttle那些不要放进来」）：
  // 只算 is_tour_bus === true 的点；后端还没带 is_tour_bus（一个点都没有这个键）时照旧全算。
  // 勾了「Tour bus departure」的点（TI）不算：团车在那里直接上客（Annie 2026-10-31 选 A，11-01「动手」）。
  const vegasKnown = day.locations.some((l) => l.is_tour_bus !== undefined);
  const activeLocs = day.locations.filter(
    (l) =>
      l.active !== false &&
      (!vegasKnown || l.is_tour_bus === true) &&
      l.is_tour_departure !== true,
  );

  const issues: RailIssue[] = [];
  const noDrv = rows.flatMap((r, i) => (hasDriver(r) ? [] : [i]));
  if (noDrv.length) {
    issues.push({
      title:
        noDrv.length === 1
          ? "1 vehicle has no driver yet"
          : `${noDrv.length} vehicles have no driver yet`,
      detail:
        "Saving is fine. A vehicle with no driver is left out when you send.",
      idx: noDrv[0],
      field: "driver",
    });
  }

  const missingTitles: string[] = [];
  META.coverage_shifts.forEach((c, i) => {
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
      sec: c,
    });
  });

  // Shuttle 上车点（Annie 2026-10-31，preview BewNcepgfaJMDPDMvo2Pdz v3 样子 1 + Schedule check；11-05 起上车点是 Vegas 酒店的客人不算，见 needsShuttlePickup）：这个团当天有要提醒的 Shuttle 客人、
  // 这个团哪台车都还没有 Shuttle 站（Pickup Locations 没勾 Tour bus 的点）时提醒；默认第一台车，在别的车选了也算（不拦）。
  // 后端没带 is_tour_bus 时分不出 Shuttle 站，不提醒。
  const shuttleAsk = new Map<number, number>();
  if (vegasKnown && shuttlePax) {
    const shuttleStop = new Set(
      day.locations.filter((l) => l.is_tour_bus !== true).map((l) => l.id),
    );
    for (const s of day.sections) {
      if (s.shift !== META.bus_tour_shift || s.manifest_id == null) continue;
      const pax = shuttlePax[s.manifest_id] ?? 0;
      if (pax <= 0) continue;
      const key = sectionKey(s);
      const mine = rows.flatMap((r, i) =>
        secOf(r) === key && !r.farm_out ? [i] : [],
      );
      if (
        mine.some((i) => rows[i].location_ids.some((l) => shuttleStop.has(l)))
      )
        continue;
      if (mine.length) shuttleAsk.set(mine[0], pax);
      issues.push({
        title: `${s.title}: shuttle pick-up not chosen`,
        detail: `${pax} shuttle guest${pax === 1 ? "" : "s"} · pick a Shuttle stop on any bus of this tour.`,
        ...(mine.length ? { idx: mine[0], field: "addstop" } : { sec: key }),
      });
    }
  }

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
    if (row.shift !== META.bus_tour_shift) return;
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
      // Annie 2026-11-03：没定位的车照发链接、客人照样签到，短信 / 邮件不提 live tracking（后端自动换字）；只标不拦。
      title: `${v.van_no} has no tracking`,
      detail:
        "Guests on it still get the link and can check in. The text doesn’t mention live tracking.",
      idx,
    });
  });

  // G250 Q8 A：锁住的团 / Relay 轮不列（锁定是系统自动的，不用员工处理）。
  const locks = day.tour_locks;
  const lockedIssue = (it: RailIssue) => {
    if (!locks) return false;
    if (it.idx != null && rows[it.idx]) return !!lockOf(locks, rows[it.idx]);
    if (it.sec) {
      const s = day.sections.find((x) => sectionKey(x) === it.sec);
      return !!s && !!lockOf(locks, s);
    }
    return false;
  };
  const shown = issues.filter((it) => !lockedIssue(it));
  const shownTitles = missingTitles.filter((t) =>
    shown.some((it) => it.title === t),
  );

  return {
    sections,
    issues: shown,
    missingTitles: shownTitles,
    coverage: META.coverage_shifts.map((c) => ({
      shift: c,
      covered: activeLocs.filter((l) => relayHotels[c].has(l.id)).length,
      total: activeLocs.length,
    })),
    driversUsed: usedDrivers.size,
    shuttleAsk,
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
