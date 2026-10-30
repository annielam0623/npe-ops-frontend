import type {
  PickupLocation,
  PickupLocationInput,
  PickupStopTime,
} from "@/types";

/** 和后端 pickup_lookup.py 的上限一致（改一边要改另一边）。 */
export const MAP_IMAGE_MAX_COUNT = 2;
export const SHORT_MAX = 120;
export const ALIASES_MAX = 500;
export const URL_MAX = 500;

/** 表单里的一份草稿：地图图片拆成一行一个输入框。 */
export interface LocationDraft {
  hotel_name: string;
  photo_url: string;
  map_images: string[];
  instruction_short: string;
  instruction: string;
  aliases: string;
  /** 类别两个勾（后端上线了才送出去，见 inputOf 的 withTypes）。 */
  is_tour_bus: boolean;
  is_shuttle: boolean;
  /** Shuttle 站的小时刻表：一行一条线路的一班，每个季节一格。先暂存，按这一行的 Save 才存。 */
  times: TimeRowDraft[];
}

/** 一格：时间、No service，或者两样都没有（= 这一季还没填）。 */
export interface TimeCellDraft {
  time: string;
  noService: boolean;
}

/** 时刻表的一行（一条线路的第几班）。 */
export interface TimeRowDraft {
  /** React key（新加的行没有服务端的号）。 */
  key: string;
  /** null = 还没选线路。 */
  product_id: number | null;
  /** 按季节 id。 */
  cells: Record<number, TimeCellDraft>;
  /** 这次新加的（标琥珀色 new）。 */
  isNew: boolean;
}

export function emptyDraft(): LocationDraft {
  return {
    hotel_name: "",
    photo_url: "",
    map_images: [""],
    instruction_short: "",
    instruction: "",
    aliases: "",
    is_tour_bus: false,
    is_shuttle: false,
    times: [],
  };
}

/** 服务端的格子 → 时刻表的行：同一条线路同一班的各季合成一行，按线路出现的先后、班次排。 */
export function timeRowsOf(
  times: PickupStopTime[] | undefined,
): TimeRowDraft[] {
  const rows = new Map<string, TimeRowDraft>();
  for (const t of times ?? []) {
    const key = `${t.product_id}:${t.run_no}`;
    const row = rows.get(key) ?? {
      key,
      product_id: t.product_id,
      cells: {},
      isNew: false,
    };
    row.cells[t.season_id] = {
      time: t.no_service ? "" : (t.stop_time ?? ""),
      noService: t.no_service,
    };
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** 时刻表的行 → 送给后端的格子。没填的格子不送（= 还没填）；同一条线路按出现先后编班次。 */
export function timesOf(
  rows: TimeRowDraft[],
): NonNullable<PickupLocationInput["times"]> {
  const runs = new Map<number, number>();
  const out: NonNullable<PickupLocationInput["times"]> = [];
  for (const row of rows) {
    if (row.product_id == null) continue;
    const run = (runs.get(row.product_id) ?? 0) + 1;
    runs.set(row.product_id, run);
    for (const [sid, cell] of Object.entries(row.cells)) {
      if (!cell.noService && !cell.time) continue;
      out.push({
        product_id: row.product_id,
        run_no: run,
        season_id: Number(sid),
        stop_time: cell.noService ? null : cell.time,
        no_service: cell.noService,
      });
    }
  }
  return out;
}

export function splitMapImages(value: string | null | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function draftOf(loc: PickupLocation): LocationDraft {
  const images = splitMapImages(loc.map_image_url);
  return {
    hotel_name: loc.hotel_name,
    photo_url: loc.photo_url ?? "",
    map_images: images.length ? images : [""],
    instruction_short: loc.instruction_short ?? "",
    instruction: loc.instruction ?? "",
    aliases: loc.aliases ?? "",
    is_tour_bus: !!loc.is_tour_bus,
    is_shuttle: !!loc.is_shuttle,
    times: timeRowsOf(loc.times),
  };
}

/**
 * 草稿 → 请求体：全部去首尾空格，地图图片去空行后按顺序换行拼起来。每次都传全 6 项。
 * withTypes（后端已经有类别）时连两个勾和 times 一起送，PUT 时 times 整份换掉。
 */
export function inputOf(
  draft: LocationDraft,
  withTypes = false,
): PickupLocationInput {
  return {
    ...(withTypes
      ? {
          is_tour_bus: draft.is_tour_bus,
          is_shuttle: draft.is_shuttle,
          times: draft.is_shuttle ? timesOf(draft.times) : [],
        }
      : {}),
    hotel_name: draft.hotel_name.trim(),
    photo_url: draft.photo_url.trim(),
    map_image_url: draft.map_images
      .map((v) => v.trim())
      .filter(Boolean)
      .join("\n"),
    instruction_short: draft.instruction_short.trim(),
    instruction: draft.instruction.trim(),
    aliases: draft.aliases.trim(),
  };
}

/** 表格里把站内长地址缩短显示（同旧页面）。 */
export function shortenUrl(url: string): string {
  return url.replace("https://nationalparkexpress.com", "…");
}

/** 只让 http(s) 地址成为可点的链接（旧页面会把任何字符串放进 href）。 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** 搜索范围同旧页面：酒店名、Details、Short、Aliases、地图图片（不含 Photo URL）。 */
export function matchesSearch(loc: PickupLocation, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [
    loc.hotel_name,
    loc.instruction,
    loc.instruction_short,
    loc.aliases,
    loc.map_image_url,
  ].some((v) => (v ?? "").toLowerCase().includes(q));
}

// ── Export CSV（Annie 2026-10-22：全部字段、只导出 active 的酒店）────────────────

/** CSV 的列顺序：和 PickupLocation 的 8 个字段一一对应。 */
const CSV_FIELDS: readonly { key: keyof PickupLocation; label: string }[] = [
  { key: "hotel_name", label: "Hotel Name" },
  { key: "photo_url", label: "Photo URL" },
  { key: "map_image_url", label: "Map image" },
  { key: "instruction_short", label: "Short (for SMS)" },
  { key: "instruction", label: "Details (email & guest page & AI Agent)" },
  { key: "aliases", label: "Aliases" },
  { key: "is_active", label: "Active" },
  { key: "is_tour_departure", label: "Tour bus departure" },
];

function csvCellValue(value: PickupLocation[keyof PickupLocation]): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

/** 只导出当前启用（active）的酒店，全部 8 个字段。 */
export function buildPickupLocationsCsv(locations: readonly PickupLocation[]): {
  headers: string[];
  rows: string[][];
} {
  const active = locations.filter((loc) => loc.is_active);
  return {
    headers: CSV_FIELDS.map((f) => f.label),
    rows: active.map((loc) => CSV_FIELDS.map((f) => csvCellValue(loc[f.key]))),
  };
}

export function pickupLocationsCsvFilename(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
  return `pickup_locations_${today}.csv`;
}

// ── Action Log ──────────────────────────────────────────────────────────────

export const LOG_FIELDS: readonly { key: string; label: string }[] = [
  { key: "hotel_name", label: "Hotel Name" },
  { key: "photo_url", label: "Photo URL" },
  { key: "instruction", label: "Details (email & guest page & AI Agent)" },
  { key: "instruction_short", label: "Short (for SMS)" },
  { key: "aliases", label: "Aliases" },
  { key: "map_image_url", label: "Map image" },
  { key: "is_tour_departure", label: "Tour bus departure" },
  { key: "is_tour_bus", label: "Type: Tour bus" },
  { key: "is_shuttle", label: "Type: Shuttle" },
  { key: "times", label: "Times" },
];

const LOG_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

export function formatLogTime(iso: string): string {
  // 没带时区的当 UTC（同旧页面）。
  const value = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? iso : LOG_TIME_FORMAT.format(time);
}

export function logValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}
