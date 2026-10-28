"use client";

import {
  ActionLogPanel,
  type ActionVerb,
} from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";

const VERBS: Record<string, ActionVerb> = {
  create: { label: "Added", tone: "add" },
  update: { label: "Edited", tone: "change" },
  rename: { label: "Renumbered", tone: "change" },
  "add column": { label: "Added column", tone: "add" },
  "rename column": { label: "Renamed column", tone: "change" },
  "hide column": { label: "Hid column", tone: "change" },
  "show column": { label: "Showed column", tone: "change" },
};

/**
 * 改动记录（G203 共用面板，后端共用读接口 /api/settings/vehicles/action-log，按 settings.vehicles）。
 * 动作名照旧页面（Renumbered、Added column…）；默认收起，第一次展开才拉，version 变了就重拉。
 */
export function VehicleLog({
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
      verbs={VERBS}
      load={(before, signal) =>
        fetchActionLog("/api/settings/vehicles/action-log", before, signal)
      }
    />
  );
}
