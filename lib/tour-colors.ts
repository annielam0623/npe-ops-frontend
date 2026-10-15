/**
 * 团的颜色：跟着团的名字走（Annie 2026-10-14），Manifests 的组 / 产品按钮和 Dispatch Step 1 团卡片的图标都用这里。
 * 改颜色、加团只改这里。名字里含关键词就用对应的颜色（不分大小写，按顺序找第一个对上的）；都对不上的用灰色。
 * 以后要让 staff 在 Settings → Products 给每个组设颜色，需要后端加一项（还没提）。
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
