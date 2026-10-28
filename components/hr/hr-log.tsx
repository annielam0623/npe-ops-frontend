"use client";

import {
  ActionLogPanel,
  type ActionVerb,
} from "@/components/action-log/action-log-panel";
import { legacyPage } from "@/lib/action-log";
import { fetchHRLog, HR_LOG_LIMIT } from "@/lib/hr-api";
import type { HRLogEntry } from "@/types";

import { fieldLabel } from "./fields";

const VERBS: Record<string, ActionVerb> = {
  export: { label: "Exported", tone: "change" },
};

/**
 * 改动记录（G203 共用面板）。HR 只记哪些字段、谁改的，不记值：每条一行，What 写同旧页面的说法，
 * From → To 写「Values not recorded」。默认收起；version 变了就重拉。
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
      load={async (_before, signal) =>
        legacyPage(await fetchHRLog(signal), HR_LOG_LIMIT, (e) => [
          {
            at: e.created_at ?? "",
            by: e.actor_name || e.actor || "unknown",
            action: e.action,
            label: e.label,
            what: describeEntry(e),
            from: null,
            to: null,
          },
        ])
      }
    />
  );
}

function labels(keys: unknown): string {
  return Array.isArray(keys)
    ? keys.map((k) => fieldLabel(String(k))).join(", ")
    : "";
}

/** 同旧页面的说法。 */
export function describeEntry(e: HRLogEntry): string {
  const after = (e.after ?? {}) as Record<string, unknown>;
  if (e.action === "update" && Array.isArray(after.edited)) {
    const edited = after.edited as Array<{
      name?: string;
      changed_fields?: unknown;
    }>;
    const head =
      after.source === "spreadsheet"
        ? "updated from a spreadsheet"
        : "edited on the list";
    const tails: string[] = [];
    const skippedDeleted = Array.isArray(after.skipped_deleted_ids)
      ? after.skipped_deleted_ids.length
      : 0;
    const dup = Array.isArray(after.skipped_duplicates)
      ? after.skipped_duplicates.length
      : 0;
    const vanished = Array.isArray(after.vanished) ? after.vanished.length : 0;
    if (skippedDeleted) {
      tails.push(`${skippedDeleted} no longer existed and were skipped`);
    }
    if (dup) tails.push(`${dup} duplicate row(s) skipped`);
    if (vanished) tails.push(`${vanished} had been deleted`);
    if (edited.length === 0) {
      if (skippedDeleted) return "none of them still existed";
      if (dup) return `${dup} duplicate row(s) skipped, nothing changed`;
      return "nothing changed";
    }
    const people = edited
      .map((x) => `${x.name ?? "?"} (${labels(x.changed_fields)})`)
      .join("; ");
    return [head, people, ...tails].join(" — ");
  }
  if (e.action === "update") {
    const changed = labels(after.changed_fields);
    if (changed) {
      return `changed ${changed}${after.linked_account_changed ? " and the linked account" : ""}`;
    }
    return "changed the linked account";
  }
  if (e.action === "create") {
    return Array.isArray(after.imported_names) ? "imported" : "added";
  }
  if (e.action === "delete") return "deleted";
  if (e.action === "export") {
    const rows = typeof after.rows === "number" ? after.rows : null;
    return rows === null ? "exported" : `exported ${rows} row(s) to Excel`;
  }
  return e.action;
}
