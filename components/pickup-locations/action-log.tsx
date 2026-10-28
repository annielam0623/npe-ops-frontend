"use client";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";

/** 改动记录（G203 共用面板，后端共用读接口 /api/pickup-locations/action-log，按 settings.pickup）。 */
export function ActionLog({
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
      emptyText="No changes recorded yet. Logging started Aug 21, 2026."
      load={(before, signal) =>
        fetchActionLog("/api/pickup-locations/action-log", before, signal)
      }
    />
  );
}
