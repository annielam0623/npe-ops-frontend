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
