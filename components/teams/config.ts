/** 与旧页面 settings_teams.html 的 8 个预设色一致，顺序也一致。 */
export const TEAM_COLOR_PRESETS = [
  "#4285F4",
  "#34A853",
  "#FBBC05",
  "#EA4335",
  "#9C27B0",
  "#00ACC1",
  "#FF7043",
  "#546E7A",
] as const;

export const DEFAULT_TEAM_COLOR = "#4285F4";

/** 名字上限与数据库 String(100) 一致；描述上限只在前端限制（与旧页面相同）。 */
export const TEAM_NAME_MAX_LENGTH = 100;
export const TEAM_DESCRIPTION_MAX_LENGTH = 200;

/**
 * 弹窗里保存 / 删除的结果：
 * - ok：成功，由父组件关闭弹窗；
 * - error：留在弹窗里显示 message，可重试；
 * - redirecting：登录已失效、正在跳 /login，弹窗保持「进行中」状态不再操作。
 */
export type ActionResult =
  | { status: "ok" }
  | { status: "error"; message: string }
  | { status: "redirecting" };

export function formatMemberCount(count: number): string {
  return `${count} member${count === 1 ? "" : "s"}`;
}
