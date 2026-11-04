import { apiFetch } from "@/lib/api-client";

/**
 * Relay list 的颜色和每张单的纸张方向（置顶 73，Annie 2026-11-03「我要把这两项放给staff」「设置页面的方向是否可以每页独立设置」
 * 「同意全部推荐。紫色那个留给staff自己调」「动手」；preview https://claude.ai/artifact/L7Ks8gymYvsd33Q9DuLGUr）。
 * 后端（9e 评估，36 做）：GET（dispatch.view）/ PUT（dispatch.edit）`/api/settings/relay-list`，颜色和方向同一个接口；
 * PUT 只改传进去的部分、按团 / 字母合并，null = 回默认。显示色「staff 设的 → 纸本 → 团色」后端在 Relay list / 司机页 /
 * Bus Manifest 三处统一算好（relay-pull 的 tour_buses[].color、relay_color 已是最终色），前端不自己算单子上的颜色。
 * ⚠️ 字段形状照 5c 转的评估先写，后端上 main 后照真实字段核对。
 */

export type Orientation = "portrait" | "landscape";

export const ORIENTATIONS: readonly Orientation[] = ["portrait", "landscape"];

/** 接口给的方向：不认得 / 没有 = portrait（后端「没设 = portrait」）。 */
export function orientationOf(v: unknown): Orientation {
  return v === "landscape" ? "landscape" : "portrait";
}

/** 一个启用的团：当前生效色 + 默认色（纸本 → 团色），每个 bus 字母同样。 */
export interface RelaySettingsTour {
  manifest_id: number;
  name: string;
  /** 这个团「All buses」的当前色 / 默认色。 */
  color: string;
  default_color: string;
  buses: { label: string; color: string; default_color: string }[];
}

export interface RelayTourColors {
  all?: string | null;
  buses?: Record<string, string | null>;
}

export interface RelayTourOrientations {
  all?: Orientation | null;
  buses?: Record<string, Orientation | null>;
}

export interface RelayListSettings {
  /** Relay 1–6 当前色（第 7 台起从 Relay 1 轮）。 */
  colors: string[];
  /** staff 设过的团 / 字母颜色（键 = manifest_id）；没设的不在里面。 */
  tour_colors: Record<string, RelayTourColors>;
  orientations: {
    summary: Orientation;
    relay: Orientation[];
    tours: Record<string, RelayTourOrientations>;
  };
  defaults: { colors: string[] };
  tours: RelaySettingsTour[];
}

/** PUT 的形状：只带改了的部分。 */
export interface RelayListSettingsPatch {
  colors?: (string | null)[];
  tour_colors?: Record<string, RelayTourColors>;
  orientations?: {
    summary?: Orientation;
    relay?: Orientation[];
    tours?: Record<string, RelayTourOrientations>;
  };
}

const API = "/api/settings/relay-list";

export function fetchRelayListSettings(
  signal?: AbortSignal,
): Promise<RelayListSettings> {
  return apiFetch<RelayListSettings>(API, { cache: "no-store", signal });
}

export function saveRelayListSettings(
  patch: RelayListSettingsPatch,
): Promise<unknown> {
  return apiFetch<unknown>(API, { method: "PUT", body: patch });
}

// ── 弹窗里暂存的那一份（纯逻辑，checks 不用起页面也能测）────────────────────

/** 一个团在弹窗里的样子：null = 没自己设（颜色回默认 / 字母方向跟 All buses / 团方向 = portrait）。 */
export interface DraftTour {
  color: string | null;
  orientation: Orientation | null;
  buses: Record<
    string,
    { color: string | null; orientation: Orientation | null }
  >;
}

export interface RelaySettingsDraft {
  colors: string[];
  summary: Orientation;
  relay: Orientation[];
  tours: Record<string, DraftTour>;
}

export const RELAY_SLOTS = 6;

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v: unknown): v is string =>
  typeof v === "string" && HEX.test(v);

const lower = (v: string | null | undefined) =>
  isHex(v) ? v.toLowerCase() : null;

/** 接口那一份 ⇒ 弹窗暂存的一份（坏值一律当没设）。 */
export function toDraft(s: RelayListSettings): RelaySettingsDraft {
  const defaults = s.defaults?.colors ?? [];
  const colors = Array.from(
    { length: RELAY_SLOTS },
    (_, i) => lower(s.colors?.[i]) ?? lower(defaults[i]) ?? "#ffffff",
  );
  const relay = Array.from({ length: RELAY_SLOTS }, (_, i) =>
    orientationOf(s.orientations?.relay?.[i]),
  );
  const tours: Record<string, DraftTour> = {};
  for (const t of s.tours ?? []) {
    const id = String(t.manifest_id);
    const tc = s.tour_colors?.[id] ?? {};
    const to = s.orientations?.tours?.[id] ?? {};
    const buses: DraftTour["buses"] = {};
    for (const b of t.buses ?? []) {
      const o = to.buses?.[b.label];
      buses[b.label] = {
        color: lower(tc.buses?.[b.label]),
        orientation: o ? orientationOf(o) : null,
      };
    }
    tours[id] = {
      color: lower(tc.all),
      orientation: to.all ? orientationOf(to.all) : null,
      buses,
    };
  }
  return {
    colors,
    summary: orientationOf(s.orientations?.summary),
    relay,
    tours,
  };
}

/** 这个团「All buses」在弹窗里显示的颜色。 */
export function tourAllColor(t: RelaySettingsTour, d: DraftTour): string {
  return d.color ?? lower(t.default_color) ?? "#c8cdd3";
}

/**
 * 字母在弹窗里显示的颜色：自己设的 → 纸本上这个字母有自己的颜色（默认色和团默认不同）就用它 → 团 All buses 现在的颜色。
 * ⚠️ 和后端「staff 设的 → 纸本 → 团色」对过才算数（后端上 main 后核）。
 */
export function busColor(
  t: RelaySettingsTour,
  d: DraftTour,
  label: string,
): string {
  const own = d.buses[label]?.color;
  if (own) return own;
  const b = t.buses.find((x) => x.label === label);
  const def = lower(b?.default_color);
  if (def && def !== lower(t.default_color)) return def;
  return tourAllColor(t, d);
}

/** 字母有没有纸本上自己的颜色（没有 = 跟着 All buses）。 */
export function busHasOwnDefault(t: RelaySettingsTour, label: string): boolean {
  const b = t.buses.find((x) => x.label === label);
  const def = lower(b?.default_color);
  return !!def && def !== lower(t.default_color);
}

export const tourOrientation = (d: DraftTour): Orientation =>
  d.orientation ?? "portrait";

export const busOrientation = (d: DraftTour, label: string): Orientation =>
  d.buses[label]?.orientation ?? tourOrientation(d);

/** 全部方向改成一个（Set all to …）。字母清掉 = 跟 All buses。 */
export function setAllOrientations(
  d: RelaySettingsDraft,
  o: Orientation,
): RelaySettingsDraft {
  const tours: Record<string, DraftTour> = {};
  for (const [id, t] of Object.entries(d.tours)) {
    const buses: DraftTour["buses"] = {};
    for (const [l, b] of Object.entries(t.buses))
      buses[l] = { ...b, orientation: null };
    tours[id] = { ...t, orientation: o, buses };
  }
  return {
    ...d,
    summary: o,
    relay: d.relay.map(() => o),
    tours,
  };
}

/** Reset to paper colours：颜色全回默认（方向不动）。 */
export function resetColors(
  d: RelaySettingsDraft,
  defaults: string[],
): RelaySettingsDraft {
  const tours: Record<string, DraftTour> = {};
  for (const [id, t] of Object.entries(d.tours)) {
    const buses: DraftTour["buses"] = {};
    for (const [l, b] of Object.entries(t.buses))
      buses[l] = { ...b, color: null };
    tours[id] = { ...t, color: null, buses };
  }
  return {
    ...d,
    colors: d.colors.map((c, i) => lower(defaults[i]) ?? c),
    tours,
  };
}

/** 存的时候只发改了的部分（别人同时改了别的团不会被盖掉）；没改 = null。 */
export function buildPatch(
  base: RelaySettingsDraft,
  d: RelaySettingsDraft,
  defaults: string[],
): RelayListSettingsPatch | null {
  const patch: RelayListSettingsPatch = {};
  if (d.colors.some((c, i) => c !== base.colors[i]))
    patch.colors = d.colors.map((c, i) =>
      c === lower(defaults[i]) ? null : c,
    );
  const tourColors: Record<string, RelayTourColors> = {};
  const tourOr: Record<string, RelayTourOrientations> = {};
  for (const [id, t] of Object.entries(d.tours)) {
    const b0 = base.tours[id];
    if (!b0) continue;
    const c: RelayTourColors = {};
    const o: RelayTourOrientations = {};
    if (t.color !== b0.color) c.all = t.color;
    if (t.orientation !== b0.orientation) o.all = t.orientation;
    for (const [l, b] of Object.entries(t.buses)) {
      const was = b0.buses[l];
      if (!was) continue;
      if (b.color !== was.color) (c.buses ??= {})[l] = b.color;
      if (b.orientation !== was.orientation)
        (o.buses ??= {})[l] = b.orientation;
    }
    if (Object.keys(c).length) tourColors[id] = c;
    if (Object.keys(o).length) tourOr[id] = o;
  }
  if (Object.keys(tourColors).length) patch.tour_colors = tourColors;
  const orientations: NonNullable<RelayListSettingsPatch["orientations"]> = {};
  if (d.summary !== base.summary) orientations.summary = d.summary;
  if (d.relay.some((o, i) => o !== base.relay[i]))
    orientations.relay = [...d.relay];
  if (Object.keys(tourOr).length) orientations.tours = tourOr;
  if (Object.keys(orientations).length) patch.orientations = orientations;
  return Object.keys(patch).length ? patch : null;
}
