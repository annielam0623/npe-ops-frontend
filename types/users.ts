/**
 * 后台账号的角色。superadmin 只能直接改库，界面上改不出来；
 * driver / guide 是外勤身份，没有任何后台权限。
 */
export type UserRole = "superadmin" | "admin" | "staff" | "driver" | "guide";

/** POST /api/users/{id}/role 接受的角色（与后端 app/auth.py 的 ASSIGNABLE_ROLES 一致）。 */
export type AssignableRole = "staff" | "admin" | "driver" | "guide";

/** GET /api/users 返回数组中的一项；数组按 id 升序。 */
export interface AdminUser {
  id: number;
  /** 待注册邀请是占位名 `__pending_xxxxxxxx`，页面不显示。 */
  username: string;
  display_name: string | null;
  initials: string | null;
  /** 库里是自由字符串，老数据理论上可能不在 UserRole 里，按 staff 显示。 */
  role: string;
  is_active: boolean;
  /** false = 邀请还没人注册（占位账号）。 */
  invite_used: boolean;
  /** 只有注册接口会接受的邀请才有值，其余 null；拿到就能注册后台账号，不要打日志。 */
  invite_token: string | null;
  /** 发出邀请的管理员用户名。 */
  created_by: string | null;
  /** 带 +00:00 的 ISO 字符串。 */
  created_at: string | null;
  team_ids: number[];
  is_self: boolean;
}

/** POST /api/users/invite 的返回体。 */
export interface InviteResult {
  /** 后端按收到请求的地址拼的，经过代理时主机名可能不对；页面用 invite_token 自己拼。 */
  invite_url: string;
  invite_token: string;
}
