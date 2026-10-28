// ── G203 共用 Action Log ──

/**
 * 面板上的一行（后端共用读接口的形状）：一次保存改了几个字段，就拆成几行，同一次的几行 at / by 相同。
 * 后端还是旧形状的页面，由 `lib/action-log.ts` 在前端转成这个。
 */
export interface ActionLogRow {
  at: string;
  by: string;
  /** create / update / delete / deactivate / reactivate / 各页自己的动作；空串 = 不出小标签。 */
  action: string;
  /** 这一条的名字（酒店名、产品代码、人名）；what 为 null 时就是那一句话本身。 */
  label: string;
  /** 页面上看到的字段名；null = 只有一句话的旧记录。 */
  what: string | null;
  /** null = 没有这一边（新建只有 to、删除只有 from）；空串 = 原来 / 改成空的。 */
  from: string | null;
  to: string | null;
}

export interface ActionLogPage {
  entries: ActionLogRow[];
  /** 原样传回 before；null = 没有更早的了（不出 Show more）。 */
  next_cursor: string | null;
  /** 旧接口一次最多给这么多条、没有翻页：拿满了就在底下写「Showing the N most recent changes.」。 */
  capped?: number | null;
}
