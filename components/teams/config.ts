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

export function formatMemberCount(count: number): string {
  return `${count} member${count === 1 ? "" : "s"}`;
}
