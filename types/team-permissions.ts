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
  /**
   * 只给内部员工（发送类，partner 勾了也不给；Annie 2026-10-27「发送只能是我们内部员工发送」）。
   * 后端 d7 加了才有；catalog 里一项都没带时前端按 isSendCode 判断。
   */
  staff_only?: boolean;
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
  /** 邀请时给新账号的默认权限组（perm_default_items，只含 active 项）；新增人员按它预勾（后端 G184 已上线）。没带时页面让人自己选。 */
  default_items?: string[];
}

/**
 * 账号类型（Annie 2026-10-26「账号类型按建议，动手」）：partner = 外部合作方，后端 role='partner'，
 * 没接线的接口一律 403、只按勾放行。
 */
export type AccountType = "staff" | "partner";

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
  /** 保存的首页（后端 G184）；null / 空 = Dashboard。万一没带，Home 列留空。 */
  home_path?: string | null;
  /** 后端还没上线时没有这个字段：页面不出任何类型选项，和以前一样。 */
  account_type?: AccountType;
  /** 手机（staff 联络方式，后端加 admin_users.phone 以后带；没带 = 还没上）。 */
  phone?: string | null;
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
  /** 后端 8a 起带；superadmin 那行是 "staff"，靠 is_superadmin 区分。 */
  account_type?: AccountType;
  /** 手机（staff 联络方式）。 */
  phone?: string | null;
  /**
   * 关联了 Human Resource 档案的 driver / guide：HR 里的电话（Team 这里只显示，去 HR 改，
   * Annie 2026-10-29 Q3 A）。没关联 = null / 不带。
   */
  hr_phone?: string | null;
}

/** PUT /api/team/members/{id}/contact：空的存 null。 */
export interface TeamContactInput {
  email: string | null;
  /** 有 HR 档案的不带（电话照 HR）。 */
  phone?: string | null;
}

/** PUT /api/team/members/{id}、POST /api/team/invites 的请求体：四样整组替换，没给 = 没有。 */
export interface TeamSelection {
  items: string[];
  /** partner 不带（后端对 partner 的职责 400，没给 = 没有）。 */
  duties?: string[];
  team_ids: number[];
  /** null = Dashboard。 */
  home_path: string | null;
}

/** POST /api/team/invites 的请求体；account_type 只在后端支持时才带（默认 staff）。 */
export interface NewTeamInvite extends TeamSelection {
  account_type?: AccountType;
  /** 发邀请时填的联络方式，先存在占位账号上（Annie 2026-10-29 Team 联络方式 Q7 A）。 */
  email?: string | null;
  phone?: string | null;
}

export interface NewTeamAccount extends NewTeamInvite {
  username: string;
  password: string;
  initials: string;
  display_name: string | null;
  email: string | null;
  phone?: string | null;
}

export interface TeamInviteResult {
  ok: boolean;
  id: number;
  invite_url: string;
  invite_token: string;
}
