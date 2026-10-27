/**
 * Team 页（Team 权限 v2「按人打勾」，后端 app/routers/team_api.py，接口说明
 * docs/interfaces/team-permissions-v2-2026-10-24.md）。全部只有 superadmin 能调。
 */

export interface PermItem {
  code: string;
  display_name: string;
  description: string | null;
  /** 这一项后端已经在检查。 */
  wired: boolean;
}

export interface PermModule {
  code: string;
  display_name: string;
  /** 整组每一项都接上了才是 true；否则页面标「Not active yet」。 */
  wired: boolean;
  items: PermItem[];
}

export interface Duty {
  code: string;
  display_name: string;
  description: string | null;
}

export interface TeamRef {
  id: number;
  name: string;
  color: string;
}

export interface TeamCatalog {
  modules: PermModule[];
  duties: Duty[];
  teams: TeamRef[];
  /** 旧 Users 页邀请时给的默认权限组（perm_default_items）。后端 2026-10-25 登记要加，没上线前没有。 */
  default_items?: string[];
}

export interface TeamMemberUser {
  kind: "user";
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  can_login: boolean;
  pending_invite: boolean;
  is_superadmin: boolean;
  team_ids: number[];
  item_count: number;
  duties: string[];
  /** 后端 2026-10-25 登记要加；没有时页面不显示首页。null / 空 = Dashboard。 */
  home_path?: string | null;
}

export interface TeamMemberContact {
  kind: "dept_contact";
  id: number;
  name: string;
  email: string;
  duties: string[];
}

export type TeamMember = TeamMemberUser | TeamMemberContact;

export interface TeamMemberDetail {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  can_login: boolean;
  pending_invite: boolean;
  is_superadmin: boolean;
  items: string[];
  duties: string[];
  team_ids: number[];
  home_path: string | null;
}

/** PUT /api/team/members/{id}、POST /api/team/invites 的请求体：四样整组替换，没给 = 没有。 */
export interface TeamSelection {
  items: string[];
  duties: string[];
  team_ids: number[];
  /** null = Dashboard。 */
  home_path: string | null;
}

export interface NewTeamAccount extends TeamSelection {
  username: string;
  password: string;
  initials: string;
  display_name: string | null;
  email: string | null;
}

export interface TeamInviteResult {
  ok: boolean;
  id: number;
  invite_url: string;
  invite_token: string;
}
