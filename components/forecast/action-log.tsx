"use client";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";

/**
 * 表底部的 Action Log（G81，G203 换成共用面板 + 共用读接口 /api/forecast/action-log）：
 * 每天的开关团 / 上限、格子（只有一句话）、导游排班增删、设置（只给 admin）；partner 403。
 * 默认收起，展开才去拉；最近 50 条新的在上，Show more 往前翻。refreshKey 变了（表上刚存了一处）且已展开 ⇒ 重拉第一页。
 */
export function ActionLog({ refreshKey }: { refreshKey: number }) {
  return (
    <ActionLogPanel
      refreshKey={refreshKey}
      emptyText="Nothing has been changed yet."
      load={(before, signal) =>
        fetchActionLog("/api/forecast/action-log", before, signal)
      }
    />
  );
}
