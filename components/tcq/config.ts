import type {
  TcqOption,
  TcqParsed,
  TcqParsedService,
  TcqQuotePreview,
  TcqRate,
  TcqRequest,
  TcqRequestService,
  TcqServiceKind,
  TcqVehicle,
} from "@/types/tcq";

/**
 * 审核页的草稿：存在工作项的 `edited` 里（形状由前端定，后端原样存）。输入框里的数字先存文字，
 * 发请求前才换成数（`buildRequest`），打字打到一半也不丢。
 */
export interface DraftService {
  key: string;
  date: string;
  service: TcqServiceKind | "";
  pax: string;
  flight: string;
  time: string;
  international: boolean | null;
  places: string[];
  hours: string;
  rate: TcqRate;
  description: string;
  /** 原文这一行（读出来的；手动加的可能是空）。 */
  line: string;
  /** 读取时的黄色提示，原样显示。 */
  flags: string[];
  selected: number[];
  /** 改过的价（美元文字），按 vehicle_id。没有 = 按价目表。 */
  prices: Record<string, string>;
}

export interface DraftManualLine {
  key: string;
  /** "" = 自己一块（group 是块名）。 */
  vehicle_id: string;
  group: string;
  date: string;
  description: string;
  qty: string;
  unit: string;
  taxable: boolean;
}

export interface TcqDraft {
  module: "tcq";
  version: 1;
  client: string;
  services: DraftService[];
  manual_lines: DraftManualLine[];
  gratuity: "line" | "terms";
  tax: boolean;
  inclusions: string | null;
  not_included: string | null;
  assumptions: string | null;
  unread: string[];
}

export const SERVICE_LABEL: Record<TcqServiceKind, string> = {
  arrival: "Airport pickup",
  departure: "Airport drop-off",
  charter: "Hourly charter",
};

/** 服务类型的字色（深色卡片上）。类型是文字标签，不做胶囊。 */
export const SERVICE_COLOR: Record<TcqServiceKind, string> = {
  arrival: "#7dd3fc",
  departure: "#c4b5fd",
  charter: "#fbbf24",
};

let keySeq = 0;
export function newKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}${Date.now().toString(36)}${keySeq}`;
}

/** 同后端 `tcq_pricing.money`：$1,140 / $64.50。 */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const c = Math.abs(Math.round(cents));
  const dollars = Math.floor(c / 100).toLocaleString("en-US");
  const rest = c % 100;
  return `${sign}$${dollars}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** 美元文字 → 分。"$1,140" / "64.5" / "64.50" 都认；读不懂、负数、超过两位小数 ⇒ null。 */
export function parseDollars(raw: string): number | null {
  const s = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents <= 10_000_000 ? cents : null;
}

function isoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 审核页：「Fri, May 29」。 */
export function shortDate(iso: string): string {
  const d = isoDate(iso);
  if (!d) return iso || "No date";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** 报价单（同后端 PDF `_day`）：「Fri 5/29/2026」。 */
export function sheetDate(iso: string | null): string {
  if (!iso) return "";
  const d = isoDate(iso);
  if (!d) return iso;
  const wd = d.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${wd} ${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** 同后端 PDF `_qty`：1 / 2.5。 */
export function qtyLabel(q: string): string {
  const f = Number(q);
  return Number.isFinite(f) ? String(f) : q;
}

export function hoursLabel(h: number): string {
  return Number.isInteger(h) ? String(h) : String(h);
}

function numText(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

export function isTcqDraft(v: unknown): v is TcqDraft {
  return (
    !!v &&
    typeof v === "object" &&
    (v as TcqDraft).module === "tcq" &&
    (v as TcqDraft).version === 1 &&
    Array.isArray((v as TcqDraft).services)
  );
}

export function isTcqParsed(v: unknown): v is TcqParsed {
  return (
    !!v &&
    typeof v === "object" &&
    (v as TcqParsed).module === "tcq" &&
    Array.isArray((v as TcqParsed).services)
  );
}

function fromParsed(s: TcqParsedService): DraftService {
  return {
    key: newKey("s"),
    date: s.date ?? "",
    service: s.service ?? "",
    pax: numText(s.pax),
    flight: s.flight ?? "",
    time: s.time ?? "",
    international: s.international,
    places: s.places ?? [],
    hours: numText(s.hours),
    rate: s.rate ?? "auto",
    description: "",
    line: s.line ?? "",
    flags: s.flags ?? [],
    selected: s.selected ?? [],
    prices: {},
  };
}

export function blankService(line = ""): DraftService {
  return {
    key: newKey("s"),
    date: "",
    service: "",
    pax: "",
    flight: "",
    time: "",
    international: null,
    places: [],
    hours: "",
    rate: "auto",
    description: "",
    line,
    flags: [],
    selected: [],
    prices: {},
  };
}

export function blankManualLine(): DraftManualLine {
  return {
    key: newKey("m"),
    vehicle_id: "",
    group: "",
    date: "",
    description: "",
    qty: "1",
    unit: "",
    taxable: true,
  };
}

/** 打开工作项时的草稿：存过就用存的，否则从读取结果起。 */
export function initialDraft(
  parsed: unknown,
  edited: unknown,
  title: string,
): TcqDraft {
  if (isTcqDraft(edited)) return edited;
  const p = isTcqParsed(parsed) ? parsed : null;
  return {
    module: "tcq",
    version: 1,
    client: title,
    services: (p?.services ?? []).map(fromParsed),
    manual_lines: [],
    gratuity: "terms",
    tax: true,
    inclusions: null,
    not_included: null,
    assumptions: null,
    unread: p?.unread ?? [],
  };
}

/** 坐得下的车（同后端 `tcq_pricing.fitting`）：按座位从小到大；人数不知道 ⇒ 全部。最多 10 辆。 */
export function fittingVehicles(
  vehicles: TcqVehicle[],
  pax: number | null,
): TcqVehicle[] {
  return [...vehicles]
    .sort((a, b) => a.seats - b.seats || a.id - b.id)
    .filter((v) => !pax || v.seats >= pax)
    .slice(0, 10);
}

/**
 * 卡片上列出的车：坐得下的，加上已经勾了、但人数改大后坐不下的（不然勾着的车看不见、取消不了）。
 * 价目表里停用了的车不列（也不放进请求，见 `buildRequest` 的 active）。
 */
export function shownVehicles(
  vehicles: TcqVehicle[],
  s: DraftService,
): TcqVehicle[] {
  const fit = fittingVehicles(vehicles, paxOf(s));
  const extra = vehicles.filter(
    (v) => s.selected.includes(v.id) && !fit.some((f) => f.id === v.id),
  );
  return [...fit, ...extra].sort((a, b) => a.seats - b.seats || a.id - b.id);
}

/** 勾了、但价目表里已经没有（停用了）的车：不放进报价，卡片上写一句。 */
export function goneSelected(
  vehicles: TcqVehicle[] | null,
  s: DraftService,
): number[] {
  if (!vehicles) return [];
  return s.selected.filter((id) => !vehicles.some((v) => v.id === id));
}

export function paxOf(s: DraftService): number | null {
  const n = Number(s.pax.trim());
  return s.pax.trim() && Number.isInteger(n) && n > 0 ? n : null;
}

function hoursOf(s: DraftService): number | null | "bad" {
  const t = s.hours.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : "bad";
}

/** 能算价的服务：有日期、有类型、人数 / 时数读得懂。 */
export function serviceProblem(s: DraftService): string | null {
  if (!isoDate(s.date)) return "needs a date";
  if (!s.service) return "needs a service type";
  if (s.pax.trim() && paxOf(s) == null)
    return "the number of guests must be a whole number";
  if (s.service === "charter" && hoursOf(s) === "bad")
    return "hours must be between 0 and 24";
  return null;
}

function baseService(s: DraftService): Omit<TcqRequestService, "vehicles"> {
  const h = hoursOf(s);
  return {
    date: s.date,
    service: s.service as TcqServiceKind,
    rate: s.service === "charter" ? s.rate : "auto",
    hours: s.service === "charter" && typeof h === "number" ? h : null,
    pax: paxOf(s),
    international: s.service === "arrival" ? s.international : null,
    flight: s.flight.trim(),
    time: s.time.trim(),
    places: s.places.map((p) => p.trim()).filter(Boolean),
    description: s.description.trim(),
  };
}

/**
 * 草稿 → 报价请求。返回请求和问题清单（问题非空时不该 Generate）。
 * 不能算价的服务不放进请求（问题清单里写哪一项、缺什么）。
 * `active`：价目表里在用的车（还没拿到时 null）；勾了的车不在里面 ⇒ 不放进请求（卡片上另写一句）。
 */
export function buildRequest(
  draft: TcqDraft,
  active: Set<number> | null = null,
): {
  request: TcqRequest;
  problems: string[];
} {
  const problems: string[] = [];
  const services: TcqRequestService[] = [];
  draft.services.forEach((s, i) => {
    const where = `Service ${i + 1}${s.date ? ` (${shortDate(s.date)})` : ""}`;
    const bad = serviceProblem(s);
    if (bad) {
      problems.push(`${where} ${bad}.`);
      return;
    }
    const picked = active
      ? s.selected.filter((id) => active.has(id))
      : s.selected;
    const vehicles = picked.map((id) => {
      const raw = s.prices[String(id)];
      if (raw === undefined) return { vehicle_id: id, price_cents: null };
      const cents = parseDollars(raw);
      if (cents == null)
        problems.push(
          `${where}: “${raw}” is not a price. Use a number like 210 or 64.50.`,
        );
      return { vehicle_id: id, price_cents: cents };
    });
    services.push({ ...baseService(s), vehicles });
  });
  const manual_lines = draft.manual_lines.flatMap((m, i) => {
    const where = `Extra line ${i + 1}`;
    const unit = parseDollars(m.unit);
    const qty = Number(m.qty.trim());
    let ok = true;
    if (!m.description.trim()) {
      problems.push(`${where} needs a description.`);
      ok = false;
    }
    if (unit == null) {
      problems.push(`${where}: the unit price must be a number like 64.50.`);
      ok = false;
    }
    if (!(qty > 0) || Math.round(qty * 100) !== qty * 100) {
      problems.push(
        `${where}: the quantity must be more than 0, at most two decimals.`,
      );
      ok = false;
    }
    if (m.date && !isoDate(m.date)) {
      problems.push(`${where}: the date must look like 2026-05-29.`);
      ok = false;
    }
    if (m.vehicle_id && active && !active.has(Number(m.vehicle_id))) {
      problems.push(
        `${where}: that vehicle is no longer on the rate card. Pick another block.`,
      );
      ok = false;
    }
    if (!ok) return [];
    return [
      {
        vehicle_id: m.vehicle_id ? Number(m.vehicle_id) : null,
        group: m.group.trim(),
        date: m.date || null,
        description: m.description.trim(),
        qty,
        unit_price_cents: unit as number,
        taxable: m.taxable,
      },
    ];
  });
  return {
    request: {
      client: draft.client.trim(),
      services,
      manual_lines,
      gratuity: draft.gratuity,
      tax: draft.tax,
      inclusions: draft.inclusions,
      not_included: draft.not_included,
      assumptions: draft.assumptions,
    },
    problems,
  };
}

/** 请求里有没有能出单的东西（勾了车或加了行）。 */
export function hasQuoteContent(r: TcqRequest): boolean {
  return (
    r.services.some((s) => s.vehicles.length > 0) || r.manual_lines.length > 0
  );
}

const PROBE_MARK = "#probe-";

/**
 * 每项服务、每辆坐得下的车的价：preview 只算勾了的车，所以另发一次 preview，把每项服务坐得下的车都「勾上」，
 * 说明写成记号（`#probe-<服务的 key>`），回来按记号和块的 vehicle_id 对回去。不存、不取单号。
 */
export function buildProbe(
  draft: TcqDraft,
  vehicles: TcqVehicle[],
): TcqRequest | null {
  const services: TcqRequestService[] = [];
  draft.services.forEach((s) => {
    if (serviceProblem(s)) return;
    // 后端一项服务最多 10 辆车。
    const shown = shownVehicles(vehicles, s).slice(0, 10);
    if (!shown.length) return;
    services.push({
      ...baseService(s),
      description: `${PROBE_MARK}${s.key}`,
      vehicles: shown.map((v) => ({ vehicle_id: v.id, price_cents: null })),
    });
  });
  if (!services.length) return null;
  return {
    client: "",
    services,
    manual_lines: [],
    gratuity: "terms",
    tax: false,
    inclusions: null,
    not_included: null,
    assumptions: null,
  };
}

/** probe 的结果 → 服务的 key → 每辆车的价。 */
export function readProbe(
  preview: TcqQuotePreview,
): Map<string, Map<number, TcqOption>> {
  const out = new Map<string, Map<number, TcqOption>>();
  for (const b of preview.blocks) {
    if (b.vehicle_id == null) continue;
    for (const l of b.lines) {
      if (l.kind !== "service" || !l.description.startsWith(PROBE_MARK))
        continue;
      const i = l.description.slice(PROBE_MARK.length);
      if (!out.has(i)) out.set(i, new Map());
      out.get(i)!.set(b.vehicle_id, {
        vehicle_id: b.vehicle_id,
        vehicle: b.title,
        seats: b.seats ?? 0,
        price_cents: l.original_cents ?? l.amount_cents,
        calc: l.calc ?? "",
        included_hours: l.included_hours ?? 0,
        overtime_cents: l.overtime_cents ?? 0,
        event: l.event ?? null,
        rate_used: l.rate_used ?? "normal",
      });
    }
  }
  return out;
}

/** 草稿里放不进请求、但能看出来的「改过的价」：值和价目表一样就不算改。 */
export function priceChanged(
  raw: string | undefined,
  rateCard: number | undefined,
): boolean {
  if (raw === undefined || rateCard === undefined) return false;
  const c = parseDollars(raw);
  return c != null && c !== rateCard;
}
