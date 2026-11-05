import type { RelayBus, RelayGuest, RelayPull } from "@/lib/dispatch-api";
import { orientationOf, type Orientation } from "@/lib/relay-list-settings-api";

/**
 * Relay list（Dispatch › Morning Relay「📋 Relay list」，task/relay-print）：把 relay-pull 的两轮排成纸本那几张单。
 * 样子照 Annie 定的 preview https://claude.ai/artifact/3p3STHAw1rk7ewCeQW1dma （v11）和纸本 4796_001.pdf 第 9–13 页：
 * - 每一轮一张 RELAY SPLITS 总表（字段照纸本 100% 复制），后面每台有客人的车一张分表；没客人的车不印分表（Q5）。
 * - 这台车当天也是某个团的大巴（后端 car.tour_buses 1 个）⇒ 抬头写这辆大巴、用团色，人名只读 relay 卡司机（relayCrew，总表图例里这辆大巴也一样）；0 个 = 「Relay N」。
 * - 排序：时间 → 车 → 这台车的站序（排车页，Q20）→ 名字 A–Z；没站序的排后面按酒店名。
 * - Tour 列用后端的 product_short（纸本的 GC South / LOWER / X，Annie「简写纸本里用哪个就用哪个」）。
 * - Hoover 的 Tour bus pick up 不印（Annie「hoover的司机用他的bus manifest就好了」），所以只排 relay / relay_2 两轮。
 * 纯逻辑，不请求接口；页面在 components/relay-list/。
 */

/** 只排这两轮（tour_car = Hoover 自己接，不印）。 */
export const RELAY_LIST_ROUNDS = ["relay", "relay_2"] as const;
export type RelayListRound = (typeof RELAY_LIST_ROUNDS)[number];

/** 接驳车按顺序固定配色（Q4 A，纸本 Relay 1 黄、2 橙、3 蓝）。 */
export const RELAY_CAR_COLORS = [
  "#ffff00",
  "#ffc066",
  "#9dc3e6",
  "#c5e8b7",
  "#d9c8f0",
  "#f6c6d6",
] as const;

/** 团没设颜色时（同 Bus Manifest 的 DEFAULT_TOUR_COLOR）。 */
const NO_TOUR_COLOR = "#c8cdd3";

export interface RelayCarSheet {
  /** 车在这一轮里的键（排车行 id；占位车没有 id 时用位置）。 */
  key: string;
  carId: number | null;
  /** 抬头左边：「Relay 1」或大巴「SOUTH」「ANTELOPE CANYON A」。 */
  title: string;
  /** 抬头接着写：「Bruce O - 1724」或「Carlos + Glenn - 1855=C」。 */
  who: string;
  color: string;
  /** 这台车当天也是大巴。 */
  isBus: boolean;
  /** 后端写的问题：problems（缺司机 / 没站点，挡发送）+ print_warnings（一台车挂两个团，只是提示）。 */
  problems: string[];
  rows: RelayGuest[];
  pax: number;
  /** 底部色条：这台车的客人要交给的大巴（Q3 A）。 */
  buses: RelayBus[];
  /** 打印方向（置顶 73）：车自己的 → 挂的第一辆大巴的 → portrait。 */
  orientation: Orientation;
  /** 这台车当天也是哪几辆大巴（设置弹窗「Also a relay car today」用）。 */
  tourBuses: Omit<RelayBus, "sections">[];
  /** 司机 - 车号（设置弹窗用）。 */
  driverVan: string;
}

export interface RelayRoundList {
  round: RelayListRound;
  /** 「Morning Relay · 1st Round」。 */
  name: string;
  when: string;
  /** 所有车（含没客人的），总表图例第一排用。 */
  cars: RelayCarSheet[];
  /** 总表：这一轮全部上了车的客人，带所在的车。 */
  rows: { guest: RelayGuest; car: RelayCarSheet }[];
  /** 总表图例下面几排：这一轮客人要去的大巴（按团分栏）。 */
  buses: RelayBus[];
}

const timeKey = (raw: string): number => {
  const m = /(\d{1,2}):(\d{2})\s*([AaPp])?/.exec(raw || "");
  if (!m) return 24 * 60;
  let h = Number(m[1]) % 12;
  if (m[3] && m[3].toLowerCase() === "p") h += 12;
  return h * 60 + Number(m[2]);
};

/** 打印单上的酒店名：简称 → 官方名 → 订单原文。 */
export function hotelText(g: RelayGuest): string {
  return g.hotel_short || g.hotel || g.pickup_location || "";
}

/** Tour 列：后端的简称；旧后端没有就写团名。 */
export function tourText(g: RelayGuest): string {
  return g.product_short || g.tour || "";
}

const firstName = (g: RelayGuest) => (g.name || "").trim().toLowerCase();

/** 车号=字母（纸本「2056=A」）；没字母只写车号。 */
export function vanText(b: {
  van: string | null;
  label: string | null;
}): string {
  const van = b.van || "";
  return b.label ? `${van}=${b.label}` : van;
}

/** 「Carlos + Glenn」：司机兼导游只写一次。 */
export function crewText(b: {
  driver: string | null;
  guide: string | null;
}): string {
  const d = (b.driver || "").trim();
  const g = (b.guide || "").trim();
  if (d && g && d !== g) return `${d} + ${g}`;
  return d || g || "No driver";
}

/**
 * 兼大巴的 relay 车，抬头 / 总表图例上的人：只读 relay 卡上的司机（Annie 2026-11-04 选 B「最终relay split只读staff放在relay卡里的数据」）。
 * relay 卡司机就是这辆大巴自己的司机 ⇒ 照纸本「Carlos + Glenn」带导游；换了人开 ⇒ 只写 relay 卡司机（Annie「同意你定的」）。
 */
export function relayCrew(
  relayDriver: string | null | undefined,
  bus: { driver: string | null; guide: string | null },
): { driver: string | null; guide: string | null } {
  const d = (relayDriver || "").trim();
  const same = !!d && d.toLowerCase() === (bus.driver || "").trim().toLowerCase();
  return { driver: d || null, guide: same ? bus.guide : null };
}

/** 大巴在图例 / 抬头上的名字：「SOUTH」「ANTELOPE A」（团简称没设就用团名）。 */
export function busName(b: {
  tour: string;
  tour_short?: string;
  label: string | null;
}): string {
  const t = (b.tour_short || b.tour || "").toUpperCase();
  return b.label ? `${t} ${b.label}` : t;
}

/** 底部色条一句：「Antelope Bus A: LOWER & UPPER - Luis R + Scarlett - 2056=A」。 */
export function busBar(b: RelayBus): string {
  const t = b.tour_short || b.tour;
  const head = b.label ? `${t} Bus ${b.label}` : t;
  const secs = (b.sections || []).map((s) => s.short || s.name).filter(Boolean);
  return `${head}${secs.length ? `: ${secs.join(" & ")}` : ""} - ${crewText(b)} - ${vanText(b)}`;
}

/** 图例里大巴那一格：「Luis R + Scarlett - 2056=A (LOWER+UPPER)」。 */
export function busLegend(b: RelayBus): string {
  const secs = (b.sections || []).map((s) => s.short || s.name).filter(Boolean);
  return `${crewText(b)} - ${vanText(b)}${secs.length ? ` (${secs.join("+")})` : ""}`;
}

const busKey = (b: {
  tour: string;
  label: string | null;
  van: string | null;
}) => `${b.tour}|${b.label ?? ""}|${b.van ?? ""}`;

/** 去重、按团名再按字母排（同一个团的车排在一起，总表图例按团分栏）。 */
function uniqueBuses(list: (RelayBus | null | undefined)[]): RelayBus[] {
  const seen = new Map<string, RelayBus>();
  for (const b of list) if (b && !seen.has(busKey(b))) seen.set(busKey(b), b);
  return [...seen.values()].sort(
    (a, b) =>
      a.tour.localeCompare(b.tour) ||
      (a.label ?? "").localeCompare(b.label ?? ""),
  );
}

/** 一台车里的先后：时间 → 站序 → 酒店 → 名字 A–Z。 */
function sortInCar(
  guests: RelayGuest[],
  stops: number[] | undefined,
): RelayGuest[] {
  const pos = new Map((stops ?? []).map((id, i) => [id, i]));
  const stopOf = (g: RelayGuest) =>
    g.location_id != null && pos.has(g.location_id)
      ? pos.get(g.location_id)!
      : (stops?.length ?? 0);
  return [...guests].sort(
    (a, b) =>
      timeKey(a.pickup_time) - timeKey(b.pickup_time) ||
      stopOf(a) - stopOf(b) ||
      hotelText(a).localeCompare(hotelText(b)) ||
      firstName(a).localeCompare(firstName(b)),
  );
}

/** 一轮 → 总表 + 每台车。 */
export function buildRound(
  data: RelayPull,
  round: RelayListRound,
): RelayRoundList | null {
  const blocks = data.rounds[round];
  if (!blocks) return null;
  let n = 0;
  const cars: RelayCarSheet[] = blocks.map((b, i) => {
    const tb = b.car.tour_buses ?? [];
    const rows = sortInCar(b.guests, b.car.location_ids);
    const pax = rows.reduce((s, g) => s + (g.pax ?? 0), 0);
    const buses = uniqueBuses(rows.map((g) => g.bus));
    const base = {
      key: b.car.id != null ? String(b.car.id) : `x${i}`,
      carId: b.car.id ?? null,
      problems: [...(b.car.problems ?? []), ...(b.car.print_warnings ?? [])],
      rows,
      pax,
      buses,
      orientation: orientationOf(b.car.orientation ?? tb[0]?.orientation),
      tourBuses: tb,
      driverVan: `${(b.car.driver || "No driver").trim()} - ${b.car.van || "No vehicle"}`,
    };
    if (tb.length >= 1) {
      return {
        ...base,
        title: tb.map(busName).join(" · "),
        who: tb
          .map((x) => `${crewText(relayCrew(b.car.driver, x))} - ${vanText(x)}`)
          .join(" · "),
        color: tb[0].color || NO_TOUR_COLOR,
        isBus: true,
      };
    }
    n += 1;
    return {
      ...base,
      title: `Relay ${n}`,
      who: base.driverVan,
      // 车色照后端（car.relay_color，照纸本取色）；旧后端没带时退回前端色盘。
      color:
        b.car.relay_color ||
        RELAY_CAR_COLORS[(n - 1) % RELAY_CAR_COLORS.length],
      isBus: false,
    };
  });
  const order = new Map(cars.map((c, i) => [c.key, i]));
  const rows = cars
    .flatMap((car) => car.rows.map((guest, idx) => ({ guest, car, idx })))
    .sort(
      (a, b) =>
        timeKey(a.guest.pickup_time) - timeKey(b.guest.pickup_time) ||
        order.get(a.car.key)! - order.get(b.car.key)! ||
        a.idx - b.idx,
    )
    .map(({ guest, car }) => ({ guest, car }));
  const relayCrewByBus = new Map<string, ReturnType<typeof relayCrew>>();
  for (const b of blocks)
    for (const x of b.car.tour_buses ?? [])
      if (!relayCrewByBus.has(busKey(x)))
        relayCrewByBus.set(busKey(x), relayCrew(b.car.driver, x));
  const label = data.round_labels?.[round];
  return {
    round,
    name: label?.name || round,
    when: label?.when || "",
    cars,
    rows,
    // 纸本图例：客人要去的大巴 + 这一轮里顺路接一站的大巴（South 1855=C 也列在大巴那几排）。
    // 这一轮当 relay 车开的大巴，人名换成 relay 卡司机（同抬头）；分段、团色照旧。
    buses: uniqueBuses([
      ...rows.map((r) => r.guest.bus),
      ...blocks.flatMap((b) => b.car.tour_buses ?? []),
    ]).map((x) => {
      const crew = relayCrewByBus.get(busKey(x));
      return crew ? { ...x, ...crew } : x;
    }),
  };
}

/** 换酒店要空一行：同一台车、同一家酒店连着的算一组。 */
export function newGroup(
  prev: { guest: RelayGuest; carKey: string } | null,
  cur: { guest: RelayGuest; carKey: string },
): boolean {
  return (
    prev !== null &&
    (prev.carKey !== cur.carKey ||
      hotelText(prev.guest) !== hotelText(cur.guest))
  );
}

/** 「Tue, Nov 3, 2026」（总表右上）和「11/3/26」（分表 Service Date），照纸本。 */
export function relayDates(ymd: string): { long: string; short: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const long = dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return { long, short: `${m}/${d}/${String(y).slice(2)}` };
}
