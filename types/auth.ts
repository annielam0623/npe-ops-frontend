/** GET /api/me 的返回体：当前登录的后台用户。 */
export interface CurrentUser {
  id: number;
  username: string;
  display_name: string | null;
  initials: string | null;
  role: string;
  /** admin 及以上（superadmin 也为 true）；按角色显示/隐藏请用它，不要自己比较 role 字符串。 */
  is_admin: boolean;
  is_superadmin: boolean;
}
