/**
 * 团的颜色。G142（后端 2026-10-20 `e5bdec9`）起，颜色改成「认 Settings → Products → Manifest
 * setup」：`GET /api/manifests` 的 pills、`GET /api/dispatch/day` 的 sections 都带了 `color`
 * 字段，有值就用它（`resolveTourColor`）。按团名猜的 `RULES` 只在接口没带颜色时当兜底
 * （没配过颜色、旧后端、或这颗胶囊 / 卡片本来就不对应一个团，例如 Private Tour）。
 */
const RULES: readonly [RegExp, string][] = [
  [/antelope/i, "#7a6ba8"], // 羚羊谷：Annie 指定的紫
  [/\bwest\b/i, "#ee8a2b"], // West：橙
  [/bryce/i, "#3b82f6"], // Bryce：蓝
  [/south\s*rim/i, "#4c9a5b"], // South Rim：绿
];

/** 对不上任何团、还没分组的：灰色。 */
export const OTHER_TOUR_COLOR = "#8f8c82";

export function tourColorFor(name: string): string {
  return RULES.find(([re]) => re.test(name))?.[1] ?? OTHER_TOUR_COLOR;
}

/** 接口给的颜色优先；没有（null / undefined）才按团名猜。 */
export function resolveTourColor(
  backendColor: string | null | undefined,
  name: string,
): string {
  return backendColor ?? tourColorFor(name);
}
