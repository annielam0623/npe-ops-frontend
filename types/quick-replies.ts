// ── Settings › Driver Quick Replies（G98，后端 d0 task/driver-messages）──

/** 司机能一键发给客人的一句话。 */
export interface QuickReply {
  id: number;
  body: string;
  sort_order: number;
  /** false = 关掉：司机看不到，但留着以后再开。 */
  active: boolean;
  /** G349：勾了 ⇒ 司机发这条时文字末尾自动加大巴位置链接（客人 90 分钟内能开）。新建一律 false。 */
  add_bus_map: boolean;
  /** ISO；没改过为 null。 */
  updated_at: string | null;
}
