import { apiFetch } from "@/lib/api-client";
import type { Orientation } from "@/lib/relay-list-settings-api";

/**
 * 版式设置（置顶 92，Annie「看了，同意全部推荐，记得要可以下载」+「动手」；preview v2
 * https://claude.ai/artifact/SQJtqNHSm7QSphrQiejaHL Q1–Q11 全 A）。第 1 批：Colours + Page。
 * 接口形状照后端 07 定的第 1 批（78 转）：settings 两个键 print_layout:bus_manifest / print_layout:relay_list。
 *   GET  /api/settings/print-layout?page=bus_manifest|relay_list（dispatch.view）
 *        ⇒ {page, palette, colours, ticket_rules, text, page_setup, defaults:{…同名}, boxes:[{key,label,has_color,default_on,default_color}], tours?}
 *   PUT  同路径（dispatch.edit），body 只带改了的顶层键（palette / colours / ticket_rules / text / page_setup），null = 回默认，
 *        坏值 400 全不改；返回 {ok, …整份}。
 * colours = {all:{<box>:{on, color}}, tours:{"<manifest_id>":{<box>:{on,color}, sections:{"<节名小写>":"#rrggbb"}}}}；生效 团 > all > 默认。
 * ⚠️ 后端还没上线，前端照这个形状写 mock；上线后核一遍。
 *
 * 前端里面用的形状（下面 PrintLayoutSettings）跟接口差一点：团的格子收在 boxes 里、页面设置叫 page；进出接口时 normalize / toApi 换。
 */

export type LayoutPage = "bus_manifest" | "relay_list";
export type Paper = "a4" | "letter";

/** 一种格：on = 上不上色（关了 = 白底）；color = #rrggbb。没有 = 跟下一层。 */
export interface BoxSetting {
  on?: boolean | null;
  color?: string | null;
}

/** 票型颜色规则：Quantities 原文里含 contains（不分大小写、忽略空格）⇒ color（null = 不上色）。从上往下第一条对上的算。 */
export interface TicketRule {
  contains: string;
  color: string | null;
}

export interface TourLayout {
  boxes?: Record<string, BoxSetting>;
  /** 每节标题 / Cfm # 小框的颜色（节名小写）。 */
  sections?: Record<string, string>;
}

export interface PrintLayoutSettings {
  /** Colour choices（色盘）；null = 默认那组。 */
  palette: string[] | null;
  colours: {
    all: Record<string, BoxSetting>;
    tours: Record<string, TourLayout>;
  };
  /** 只 Bus Manifest：票型规则表；null = 默认（现在的 4 条）。其他带「+」的颜色是 ticket_plus 那一格。 */
  ticket_rules: TicketRule[] | null;
  page: {
    paper: Paper | null;
    /** 四边一个边距；null = 现在的边距。 */
    margin_mm: number | null;
    /** 每种单的竖 / 横（Bus Manifest：bus / lunch）；Relay list 的方向照旧在 relay_list 设置里。 */
    sheets: Record<string, Orientation | null>;
  };
}

export interface BoxInfo {
  key: string;
  label: string;
  has_color: boolean;
  default_on: boolean;
  default_color: string | null;
}

export interface PrintLayoutDefaults {
  palette: string[];
  boxes: Record<string, { on: boolean; color: string | null }>;
  ticket_rules: TicketRule[];
  page: {
    paper: Paper;
    margin_mm: number | null;
    sheets: Record<string, Orientation>;
  };
}

/** 前端用的一份。 */
export interface PrintLayoutResponse {
  page: LayoutPage;
  settings: PrintLayoutSettings;
  defaults: PrintLayoutDefaults;
  /** 后端认得的格子（不在里面的前端不出那一行）。 */
  boxes: BoxInfo[];
}

/** 接口原样（07 的形状）。 */
interface ApiTour {
  sections?: Record<string, string>;
  [box: string]: BoxSetting | Record<string, string> | undefined;
}
interface ApiPageSetup {
  paper?: Paper | null;
  margin_mm?: number | null;
  sheets?: Record<string, Orientation | null>;
}
interface ApiLayout {
  page: LayoutPage;
  palette?: string[] | null;
  colours?: {
    all?: Record<string, BoxSetting>;
    tours?: Record<string, ApiTour>;
  } | null;
  ticket_rules?: TicketRule[] | null;
  text?: unknown;
  page_setup?: ApiPageSetup | null;
  defaults?: {
    palette?: string[];
    ticket_rules?: TicketRule[];
    page_setup?: ApiPageSetup;
  };
  boxes?: BoxInfo[];
}

/**
 * PUT：只带改了的。后端 07（task/print-layout 4d2331be）是**按格合并**：colours / text / page_setup 里每一格、每一项
 * null = 回默认，没带的不动；palette / ticket_rules 整张换（null = 默认）。所以这里送的是差异，不是整块。
 */
export interface PrintLayoutPatch {
  palette?: string[] | null;
  colours?: {
    all?: Record<string, { on: boolean | null; color: string | null } | null>;
    tours?: Record<
      string,
      | (Record<string, { on: boolean | null; color: string | null } | null> & {
          sections?: Record<string, string | null>;
        })
      | null
    >;
  };
  ticket_rules?: TicketRule[] | null;
  page_setup?: ApiPageSetup | null;
}

const API = "/api/settings/print-layout";

export async function fetchPrintLayout(
  page: LayoutPage,
  signal?: AbortSignal,
): Promise<PrintLayoutResponse> {
  return normalize(
    await apiFetch<ApiLayout>(API, {
      cache: "no-store",
      signal,
      query: { page },
    }),
  );
}

export async function savePrintLayout(
  page: LayoutPage,
  patch: PrintLayoutPatch,
): Promise<PrintLayoutResponse> {
  return normalize(
    await apiFetch<ApiLayout>(API, {
      method: "PUT",
      query: { page },
      body: patch,
    }),
  );
}

// ── 纯逻辑 ───────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (v: unknown): v is string =>
  typeof v === "string" && HEX.test(v);

/** 边距范围（后端 07：5..25 mm）。 */
export const MARGIN_MIN = 5;
export const MARGIN_MAX = 25;
export const RULES_MAX = 30;
export const PALETTE_MAX = 40;

const lower = (v: unknown) => (isHexColor(v) ? v.toLowerCase() : null);

function cleanBox(b: unknown): BoxSetting | null {
  if (!b || typeof b !== "object") return null;
  const x = b as BoxSetting;
  const out: BoxSetting = {};
  if (typeof x.on === "boolean") out.on = x.on;
  const c = lower(x.color);
  if (c) out.color = c;
  return Object.keys(out).length ? out : null;
}

function cleanRules(v: unknown): TicketRule[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((r) => r && typeof r.contains === "string")
    .map((r) => ({ contains: r.contains as string, color: lower(r.color) }));
}

function cleanSheets(v: unknown): Record<string, Orientation | null> {
  const out: Record<string, Orientation | null> = {};
  for (const [k, o] of Object.entries((v as object) ?? {}))
    if (o === "portrait" || o === "landscape") out[k] = o;
  return out;
}

/** 接口那一份 ⇒ 前端用的（坏值当没设）。 */
export function normalize(r: ApiLayout): PrintLayoutResponse {
  const all: Record<string, BoxSetting> = {};
  for (const [k, v] of Object.entries(r.colours?.all ?? {})) {
    const c = cleanBox(v);
    if (c) all[k] = c;
  }
  const tours: Record<string, TourLayout> = {};
  for (const [id, t] of Object.entries(r.colours?.tours ?? {})) {
    if (!t || typeof t !== "object") continue;
    const boxes: Record<string, BoxSetting> = {};
    const sections: Record<string, string> = {};
    for (const [k, v] of Object.entries(t)) {
      if (k === "sections") {
        for (const [sk, sv] of Object.entries((v as object) ?? {})) {
          const c = lower(sv);
          if (c) sections[sk.trim().toLowerCase()] = c;
        }
      } else {
        const c = cleanBox(v);
        if (c) boxes[k] = c;
      }
    }
    const one: TourLayout = {};
    if (Object.keys(boxes).length) one.boxes = boxes;
    if (Object.keys(sections).length) one.sections = sections;
    if (Object.keys(one).length) tours[id] = one;
  }
  const ps = r.page_setup ?? {};
  const margin = ps.margin_mm;
  const settings: PrintLayoutSettings = {
    palette: Array.isArray(r.palette)
      ? r.palette.filter(isHexColor).map((c) => c.toLowerCase())
      : null,
    colours: { all, tours },
    ticket_rules: cleanRules(r.ticket_rules),
    page: {
      paper: ps.paper === "a4" || ps.paper === "letter" ? ps.paper : null,
      margin_mm:
        typeof margin === "number" &&
        margin >= MARGIN_MIN &&
        margin <= MARGIN_MAX
          ? margin
          : null,
      sheets: cleanSheets(ps.sheets),
    },
  };
  const boxes = (r.boxes ?? []).filter((b) => b && typeof b.key === "string");
  const dps = r.defaults?.page_setup ?? {};
  const dSheets: Record<string, Orientation> = {};
  for (const [k, o] of Object.entries(cleanSheets(dps.sheets)))
    if (o) dSheets[k] = o;
  const defaults: PrintLayoutDefaults = {
    palette: (r.defaults?.palette ?? []).filter(isHexColor).map((c) => c.toLowerCase()),
    boxes: Object.fromEntries(
      boxes.map((b) => [
        b.key,
        { on: b.default_on !== false, color: lower(b.default_color) },
      ]),
    ),
    ticket_rules: cleanRules(r.defaults?.ticket_rules) ?? [],
    page: {
      paper: dps.paper === "letter" ? "letter" : "a4",
      margin_mm: typeof dps.margin_mm === "number" ? dps.margin_mm : null,
      sheets: dSheets,
    },
  };
  return { page: r.page, settings, defaults, boxes };
}

export const EMPTY_SETTINGS: PrintLayoutSettings = {
  palette: null,
  colours: { all: {}, tours: {} },
  ticket_rules: null,
  page: { paper: null, margin_mm: null, sheets: {} },
};

export interface ResolvedBox {
  on: boolean;
  /** 上色时用的颜色；null = 用页面数据自己的颜色（例如每节纸本色）。 */
  color: string | null;
}

/** 一种格最后的样子：这个团 → All tours → 默认。tourId = null 只看 All tours。 */
export function resolveBox(
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
  key: string,
  tourId: string | null,
): ResolvedBox {
  const def = d.boxes[key] ?? { on: true, color: null };
  const tour = tourId ? s.colours.tours[tourId]?.boxes?.[key] : undefined;
  const all = s.colours.all[key];
  return {
    on: tour?.on ?? all?.on ?? def.on,
    color: tour?.color ?? all?.color ?? def.color,
  };
}

/** 这一层（All tours 或某个团）自己设了的那一格（弹窗里画橙线、Reset 用）。 */
export function ownBox(
  s: PrintLayoutSettings,
  key: string,
  tourId: string | null,
): BoxSetting | undefined {
  return tourId ? s.colours.tours[tourId]?.boxes?.[key] : s.colours.all[key];
}

/** 改这一层的一格（不可变）；空了就删掉。 */
export function setBox(
  s: PrintLayoutSettings,
  key: string,
  tourId: string | null,
  next: BoxSetting | null,
): PrintLayoutSettings {
  const tidy = next ? cleanBox(next) : null;
  if (!tourId) {
    const all = { ...s.colours.all };
    if (tidy) all[key] = tidy;
    else delete all[key];
    return { ...s, colours: { ...s.colours, all } };
  }
  const t = { ...(s.colours.tours[tourId] ?? {}) };
  const boxes = { ...(t.boxes ?? {}) };
  if (tidy) boxes[key] = tidy;
  else delete boxes[key];
  if (Object.keys(boxes).length) t.boxes = boxes;
  else delete t.boxes;
  return setTour(s, tourId, t);
}

export function setSection(
  s: PrintLayoutSettings,
  tourId: string,
  section: string,
  color: string | null,
): PrintLayoutSettings {
  const t = { ...(s.colours.tours[tourId] ?? {}) };
  const sections = { ...(t.sections ?? {}) };
  const k = section.trim().toLowerCase();
  const c = lower(color);
  if (c) sections[k] = c;
  else delete sections[k];
  if (Object.keys(sections).length) t.sections = sections;
  else delete t.sections;
  return setTour(s, tourId, t);
}

function setTour(
  s: PrintLayoutSettings,
  tourId: string,
  t: TourLayout,
): PrintLayoutSettings {
  const tours = { ...s.colours.tours };
  if (Object.keys(t).length) tours[tourId] = t;
  else delete tours[tourId];
  return { ...s, colours: { ...s.colours, tours } };
}

const squash = (v: string) => v.toLowerCase().replace(/\s+/g, "");

/** 票型格的颜色（同后端 07：第一条对上的算，不分大小写、忽略空格；都没对上又带「+」⇒ ticket_plus）。 */
export function ticketColorBy(
  rules: TicketRule[],
  plusColor: string | null,
  ticket: string | null | undefined,
): string | null {
  const t = squash(ticket ?? "");
  for (const r of rules) {
    const c = squash(r.contains);
    if (c && t.includes(c)) return r.color;
  }
  return t.includes("+") ? plusColor : null;
}

export const effectiveRules = (
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
): TicketRule[] => s.ticket_rules ?? d.ticket_rules;

/** 其他带「+」的票型（ticket_plus 那一格，只有 All tours 一层）：关了 = null。 */
export function effectivePlus(
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
): string | null {
  const b = resolveBox(s, d, "ticket_plus", null);
  return b.on ? (b.color ?? "#fff200") : null;
}

export const effectivePalette = (
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
): string[] => s.palette ?? d.palette;

export const effectivePaper = (
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
): Paper => s.page.paper ?? d.page.paper;

export const effectiveMargin = (
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
): number | null => s.page.margin_mm ?? d.page.margin_mm;

export const effectiveSheet = (
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
  sheet: string,
): Orientation => s.page.sheets[sheet] ?? d.page.sheets[sheet] ?? "portrait";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const keysOf = (a: object | undefined, b: object | undefined) =>
  [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];

/** 一层格子的差异：去掉了 ⇒ null；改了 ⇒ {on, color} 两项都带（没设的那项 null = 回默认）。 */
function boxesDiff(
  a: Record<string, BoxSetting> | undefined,
  b: Record<string, BoxSetting> | undefined,
) {
  const out: Record<string, { on: boolean | null; color: string | null } | null> =
    {};
  for (const k of keysOf(a, b)) {
    if (same(a?.[k], b?.[k])) continue;
    const x = b?.[k];
    out[k] = x ? { on: x.on ?? null, color: x.color ?? null } : null;
  }
  return out;
}

/** 存的时候只发改了的（按格的差异）；没改 = null。 */
export function buildLayoutPatch(
  base: PrintLayoutSettings,
  d: PrintLayoutSettings,
): PrintLayoutPatch | null {
  const patch: PrintLayoutPatch = {};
  if (!same(base.palette, d.palette)) patch.palette = d.palette;
  const colours: NonNullable<PrintLayoutPatch["colours"]> = {};
  const all = boxesDiff(base.colours.all, d.colours.all);
  if (Object.keys(all).length) colours.all = all;
  const tours: NonNullable<NonNullable<PrintLayoutPatch["colours"]>["tours"]> =
    {};
  for (const id of keysOf(base.colours.tours, d.colours.tours)) {
    const a = base.colours.tours[id];
    const b = d.colours.tours[id];
    if (same(a, b)) continue;
    if (!b) {
      tours[id] = null;
      continue;
    }
    const one: Record<string, unknown> = boxesDiff(a?.boxes, b.boxes);
    const secs: Record<string, string | null> = {};
    for (const k of keysOf(a?.sections, b.sections))
      if (!same(a?.sections?.[k], b.sections?.[k]))
        secs[k] = b.sections?.[k] ?? null;
    if (Object.keys(secs).length) one.sections = secs;
    tours[id] = one as NonNullable<typeof tours[string]>;
  }
  if (Object.keys(tours).length) colours.tours = tours;
  if (Object.keys(colours).length) patch.colours = colours;
  if (!same(base.ticket_rules, d.ticket_rules))
    patch.ticket_rules = d.ticket_rules;
  const ps: ApiPageSetup = {};
  if (base.page.paper !== d.page.paper) ps.paper = d.page.paper;
  if (base.page.margin_mm !== d.page.margin_mm) ps.margin_mm = d.page.margin_mm;
  const sheets: Record<string, Orientation | null> = {};
  for (const k of keysOf(base.page.sheets, d.page.sheets))
    if ((base.page.sheets[k] ?? null) !== (d.page.sheets[k] ?? null))
      sheets[k] = d.page.sheets[k] ?? null;
  if (Object.keys(sheets).length) ps.sheets = sheets;
  if (Object.keys(ps).length) patch.page_setup = ps;
  return Object.keys(patch).length ? patch : null;
}

/** 改了几处（弹窗底下「n changes not saved」）。 */
export function countChanges(
  base: PrintLayoutSettings,
  d: PrintLayoutSettings,
): number {
  let n = 0;
  if (!same(base.palette, d.palette)) n++;
  const keys = (a: object | undefined, b: object | undefined) =>
    new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys(base.colours.all, d.colours.all))
    if (!same(base.colours.all[k], d.colours.all[k])) n++;
  for (const id of keys(base.colours.tours, d.colours.tours)) {
    const a = base.colours.tours[id] ?? {};
    const b = d.colours.tours[id] ?? {};
    for (const k of keys(a.boxes, b.boxes))
      if (!same(a.boxes?.[k], b.boxes?.[k])) n++;
    for (const k of keys(a.sections, b.sections))
      if (!same(a.sections?.[k], b.sections?.[k])) n++;
  }
  if (!same(base.ticket_rules, d.ticket_rules)) n++;
  if (!same(base.page.paper, d.page.paper)) n++;
  if (!same(base.page.margin_mm, d.page.margin_mm)) n++;
  for (const k of keys(base.page.sheets, d.page.sheets))
    if (!same(base.page.sheets[k] ?? null, d.page.sheets[k] ?? null)) n++;
  return n;
}

/** Reset all to paper：全部清掉（= 全回默认）。 */
export const resetAll = (): PrintLayoutSettings => EMPTY_SETTINGS;
