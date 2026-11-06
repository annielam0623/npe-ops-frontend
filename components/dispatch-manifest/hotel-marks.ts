import type {
  ManifestGuest,
  ManifestSection,
  ManifestView as ManifestData,
} from "@/types";

/** 节颜色：节自己的 → tour 节用团的节色 → shuttle 用 out / in 的色（同后端打印页 sec_color）。 */
export function sectionColor(data: ManifestData, s: ManifestSection): string {
  if (s.color) return s.color;
  if (s.kind === "tour") return data.tour.section_color;
  return data.shuttle_colors[s.kind];
}

/**
 * 酒店隔组标色（G198 Q2 A，Annie「198全按推荐」）：同一家连着的算一组，第一组不标、第二组标、第三组不标……，
 * 标的那组只标第一行。比的是 Pick-up Location 原文（去空格、不分大小写）。只给 tour 节。
 * 车上的表和 Affiliate 栏共用（同后端 tour_manifest.hotel_marks()，打印页两处一样标）。
 */
export function hotelMarks(guests: ManifestGuest[]): boolean[] {
  const out = guests.map(() => false);
  let group = -1;
  let prev: string | null = null;
  guests.forEach((g, i) => {
    const h = g.pickup_location.trim().toLowerCase();
    if (h !== prev) {
      group += 1;
      prev = h;
      if (group % 2 === 1) out[i] = true;
    }
  });
  return out;
}
