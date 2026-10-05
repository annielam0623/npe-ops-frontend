import type { PickupLocation, PickupLocationInput } from "@/types";

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
}

export function emptyDraft(): LocationDraft {
  return {
    hotel_name: "",
    photo_url: "",
    map_images: [""],
    instruction_short: "",
    instruction: "",
    aliases: "",
  };
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
  };
}

/** 草稿 → 请求体：全部去首尾空格，地图图片去空行后按顺序换行拼起来。每次都传全 6 项。 */
export function inputOf(draft: LocationDraft): PickupLocationInput {
  return {
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

// ── Action Log ──────────────────────────────────────────────────────────────

export const LOG_FIELDS: readonly { key: string; label: string }[] = [
  { key: "hotel_name", label: "Hotel Name" },
  { key: "photo_url", label: "Photo URL" },
  { key: "instruction", label: "Details (email & guest page)" },
  { key: "instruction_short", label: "Short (for SMS)" },
  { key: "aliases", label: "Aliases" },
  { key: "map_image_url", label: "Map image" },
  { key: "is_tour_departure", label: "Tour bus departure" },
];

export const LOG_VERB: Record<string, { label: string; className: string }> = {
  create: { label: "Added", className: "bg-emerald-100 text-emerald-800" },
  update: { label: "Changed", className: "bg-blue-100 text-blue-800" },
  delete: { label: "Deleted", className: "bg-red-100 text-red-800" },
  deactivate: { label: "Deactivated", className: "bg-blue-100 text-blue-800" },
  reactivate: { label: "Reactivated", className: "bg-blue-100 text-blue-800" },
};

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
