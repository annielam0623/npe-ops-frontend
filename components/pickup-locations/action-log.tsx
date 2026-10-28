"use client";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { legacyPage, legacyRows } from "@/lib/action-log";
import { fetchPickupLog, PICKUP_LOG_LIMIT } from "@/lib/pickup-locations-api";

import { LOG_FIELDS, logValue } from "./config";

/** 改动记录（G203 共用面板）：旧接口整行 before / after，在前端拆成逐字段。 */
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
      load={async (_before, signal) =>
        legacyPage(await fetchPickupLog(signal), PICKUP_LOG_LIMIT, (e) =>
          legacyRows(e, { fields: LOG_FIELDS, show: (_k, v) => logValue(v) }),
        )
      }
    />
  );
}
