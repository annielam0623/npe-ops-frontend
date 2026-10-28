"use client";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";

/**
 * 改动记录（G203 共用面板，后端共用读接口 /api/settings/products/action-log，按 settings.products）：
 * 产品、团组、订单类别；Manifest setup 的记录后端只给 admin / superadmin。组 id、分类、团型后端已换成名字。
 * 默认收起，第一次展开才拉；version 变了（有改动）就重拉。
 */
export function ProductLog({
  version,
  onUnauthorized,
}: {
  version: number;
  onUnauthorized: () => void;
}) {
  return (
    <ActionLogPanel
      refreshKey={version}
      onUnauthorized={onUnauthorized}
      load={(before, signal) =>
        fetchActionLog("/api/settings/products/action-log", before, signal)
      }
    />
  );
}
