// ── Settings › Driver Quick Replies（G98，后端 d0 task/driver-messages）──

/** 司机能一键发给客人的一句话。 */
export interface QuickReply {
  id: number;
  body: string;
  sort_order: number;
  /** false = 关掉：司机看不到，但留着以后再开。 */
  active: boolean;
  /** ISO；没改过为 null。 */
  updated_at: string | null;
}

/** GET /api/driver-quick-replies/log 的一条（fetch_log 旧形状，整行 before / after）。 */
export interface QuickReplyLogEntry {
  id: number;
  entity_id: string | null;
  label: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  actor_name: string;
  created_at: string | null;
}
