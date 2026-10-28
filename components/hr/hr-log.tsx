"use client";

import {
  ActionLogPanel,
  type ActionVerb,
} from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";

const VERBS: Record<string, ActionVerb> = {
  export: { label: "Exported", tone: "change" },
};

/**
 * 改动记录（G203 共用面板，后端共用读接口 /api/hr/action-log）。HR 只记哪些字段、谁改的，不记值：
 * 后端每个字段一行、from / to 为 null，From → To 写「Values not recorded」。默认收起；version 变了就重拉。
 */
export function HRLog({
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
      note="Records which fields changed and who changed them — never the values themselves."
      emptyText="No activity yet."
      missingText="Values not recorded"
      load={(before, signal) =>
        fetchActionLog("/api/hr/action-log", before, signal)
      }
    />
  );
}
