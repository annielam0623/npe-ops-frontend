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
  /**
   * 这次会话的登录时间（ISO，UTC；置顶 83，后端 94）。Dispatch 12:00 AM–8:30 AM（洛杉矶）登录的默认看今天（134 起点由 2:00 改 0:00）。
   * 旧后端没有这个字段 ⇒ 照旧。
   */
  logged_in_at?: string | null;
  /**
   * 147 / G318：这个人今天在已发布的 Staff Schedule 里是 Open 班，并且现在（洛杉矶）在 Super Admin 设的时间窗内
   *（默认 12:00 AM–10:00 AM）⇒ true，Dispatch 打开时默认看今天。后端每次请求现算；false 或旧后端没有 ⇒ 走登录时间规则。
   */
  dispatch_open_today?: boolean;
}
