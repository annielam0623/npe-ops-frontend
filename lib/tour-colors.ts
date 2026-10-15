/**
 * 团的颜色：Dispatch Step 1 团卡片的图标（components/dispatch-manifest/manifests-panel.tsx 的 TILE，旧 `.tm-tile.c0`–`c3`）
 * 和 Manifests 的组 / 产品按钮共用这一套（Annie 2026-10-14：两边统一）。按在页面上的先后顺序轮流配，不是固定给某个团。
 * 改颜色时两处一起改：这里 + manifests-panel.tsx 的 TILE。
 */
export const TOUR_COLORS = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea7a0c",
] as const;

export function tourColor(index: number): string {
  return TOUR_COLORS[index % TOUR_COLORS.length];
}
