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
  /**
   * supervisor 及以上（admin、superadmin 也为 true）。后端加 supervisor 角色时才有这个字段，
   * 没有 = 后端还不认 supervisor（见 `supportsSupervisor`）。
   */
  is_supervisor?: boolean;
}
