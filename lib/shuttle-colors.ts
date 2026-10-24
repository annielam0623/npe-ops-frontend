import type {
  ShuttleProduct,
  ShuttleProductDirection,
} from "@/lib/shuttle-products-api";

/**
 * Shuttle 药丸的颜色工具（Annie 2026-10-23：颜色 = 团（Group），实心 = inbound，空心 = outbound）。
 * 颜色本身读 Products → Manifest setup 的团颜色（`manifest_color`），这里只负责：没有颜色时的灰、
 * 按底色自动选字（实心药丸白 / 深字，空心药丸把同色加深到够清楚）、产品名里取出线路和夏冬班次、排序。
 */

/** Products 里没配过颜色时的灰（同 Manifest setup 的默认灰）。 */
export const DEFAULT_GROUP_COLOR = "#c8cdd3";

function toRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: number[]): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function luminance([r, g, b]: number[]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: number[], b: number[]): number {
  const A = luminance(a);
  const B = luminance(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

const WHITE = [255, 255, 255];
const DARK = [26, 26, 26];

/** 接口给的颜色有可能是空 / 不是 #rrggbb：一律退回灰。 */
export function normalizeGroupColor(color: string | null | undefined): string {
  return color && toRgb(color)
    ? color.trim().toLowerCase()
    : DEFAULT_GROUP_COLOR;
}

/** 实心药丸里的字：白和深色里对比更高的那个。 */
export function inkOnSolid(hex: string): string {
  const rgb = toRgb(hex);
  if (!rgb) return "#1a1a1a";
  return contrastRatio(rgb, WHITE) >= contrastRatio(rgb, DARK)
    ? "#ffffff"
    : "#1a1a1a";
}

/** 空心药丸里的字：把同一个颜色一步步加深，直到和白底对比 ≥ 4.5。 */
export function inkOnHollow(hex: string): string {
  const rgb = toRgb(hex);
  if (!rgb) return "#1a1a1a";
  let t = 0;
  let out: number[] = rgb;
  while (contrastRatio(out, WHITE) < 4.5 && t < 1) {
    t += 0.05;
    out = rgb.map((v) => v * (1 - t));
  }
  return toHex(out);
}

export const DIRECTION_ORDER: Record<ShuttleProductDirection, number> = {
  outbound: 0,
  inbound: 1,
  roundtrip: 2,
  tour: 3,
};

export const DIRECTION_LABEL: Record<ShuttleProductDirection, string> = {
  outbound: "Outbound",
  inbound: "Inbound",
  roundtrip: "Roundtrip",
  tour: "No direction set",
};

export const DIRECTION_ARROW: Record<ShuttleProductDirection, string> = {
  outbound: "→",
  inbound: "←",
  roundtrip: "⇄",
  tour: "?",
};

/** Group 标题后面的小标签文字。 */
export const DIRECTION_TAG: Record<ShuttleProductDirection, string> = {
  outbound: "out",
  inbound: "in",
  roundtrip: "round",
  tour: "no dir",
};

export interface ShuttleNameInfo {
  /** 名字里是 “A to B” 写法。 */
  ok: boolean;
  from: string;
  to: string;
  /** 不是 “A to B” 时用去掉前缀的名字当线路名。 */
  title: string;
  /** Summer / Winter（名字末尾 “, Summer Schedule”），没有就空。 */
  season: string;
  /** 线路键：A、B 不分先后、不分大小写。 */
  key: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * 从产品名里取线路：去掉开头 `One-way Shuttle:` / `Multi-stop Shuttle:`，结尾 `, Summer|Winter Schedule` 取出当班次，
 * 剩下的按第一个 ` to ` 拆成起点和终点。拆不出来的不丢，用去掉前缀的名字当线路名。
 */
export function parseShuttleName(name: string): ShuttleNameInfo {
  let season = "";
  let s = name.replace(/^\s*(One-way|Multi-stop)\s+Shuttle:\s*/i, "");
  s = s
    .replace(/,\s*(Summer|Winter)\s+Schedule\s*$/i, (_, x: string) => {
      season = x[0].toUpperCase() + x.slice(1).toLowerCase();
      return "";
    })
    .trim();
  const m = /^(.+?)\s+to\s+(.+)$/i.exec(s);
  if (!m)
    return {
      ok: false,
      from: "",
      to: "",
      title: s,
      season,
      key: `solo|${norm(s)}`,
    };
  const from = m[1].trim();
  const to = m[2].trim();
  return {
    ok: true,
    from,
    to,
    title: "",
    season,
    key: [norm(from), norm(to)].sort().join("|"),
  };
}

/** 药丸上写的字：只写线路（Las Vegas 缩成 Vegas），夏冬班次接在后面；方向靠形状和颜色。 */
export function shuttlePillText(
  p: Pick<ShuttleProduct, "product_name">,
): string {
  const info = parseShuttleName(p.product_name);
  const short = (t: string) => t.split("Las Vegas").join("Vegas");
  const base = info.ok
    ? `${short(info.from)} to ${short(info.to)}`
    : short(info.title);
  return info.season ? `${base} · ${info.season}` : base;
}

/** 一个 Group 里的药丸顺序：先所有 out，再 in，最后 round / 没设方向；同方向按线路名字母序，夏季班挨着冬季班。 */
export function orderShuttleProducts<T extends ShuttleProduct>(list: T[]): T[] {
  const route = (p: T) => {
    const i = parseShuttleName(p.product_name);
    return i.ok ? `${norm(i.from)} to ${norm(i.to)}` : norm(i.title);
  };
  const winter = (p: T) =>
    parseShuttleName(p.product_name).season === "Winter" ? 1 : 0;
  return list
    .slice()
    .sort(
      (a, b) =>
        DIRECTION_ORDER[a.direction] - DIRECTION_ORDER[b.direction] ||
        route(a).localeCompare(route(b)) ||
        winter(a) - winter(b),
    );
}
