/** GET /api/admin/teams 返回数组中的一项；数组按 id 升序。 */
export interface Team {
  id: number;
  name: string;
  color: string;
  /** 库里允许为 null，老数据可能没有描述。 */
  description: string | null;
  member_count: number;
  /** 带 +00:00 的 ISO 字符串；页面不显示。 */
  created_at: string | null;
}

/** POST /api/teams、PUT /api/teams/{id} 的请求体（两者相同）。 */
export interface TeamInput {
  name: string;
  color: string;
  description: string;
}

/** POST /api/teams 的返回体。 */
export interface CreateTeamResult {
  ok: true;
  id: number;
  name: string;
  color: string;
}
