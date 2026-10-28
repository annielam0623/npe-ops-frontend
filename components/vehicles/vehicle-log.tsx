"use client";

import {
  ActionLogPanel,
  type ActionVerb,
} from "@/components/action-log/action-log-panel";
import { legacyPage, legacyRows, type LegacyLogEntry } from "@/lib/action-log";
import { fetchVehicleLog } from "@/lib/vehicles-api";
import type { VehicleColumn } from "@/types";

const LABELS: Array<[string, string]> = [
  ["van_no", "Number"],
  ["samsara_url", "Samsara link"],
  ["seats", "Seats"],
  ["notes", "Note"],
  ["is_active", "Active"],
  ["column", "Column"],
  ["hidden", "Hidden"],
];

/** 自加列的值在日志里的键是 col_<列 id>：按 id 换成现在的列名（改了列名，旧日志也显示新名）。 */
const COL_PREFIX = "col_";

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
 * 改动记录（G203 共用面板），默认收起；第一次展开才拉，version 变了就重拉。
 * 停用 / 恢复同旧页面按字段写（Active: true → false），不并成 Status 一行。
 */
export function VehicleLog({
  version,
  columns,
  onUnauthorized,
}: {
  version: number;
  columns: VehicleColumn[];
  onUnauthorized: () => void;
}) {
  const colName = (id: string) =>
    columns.find((c) => String(c.id) === id)?.label ?? "Extra column";
  const fields = (entry: LegacyLogEntry) => [
    ...LABELS.map(([key, label]) => ({ key, label })),
    ...Object.keys(entry.after ?? {})
      .filter((k) => k.startsWith(COL_PREFIX))
      .map((k) => ({ key: k, label: colName(k.slice(COL_PREFIX.length)) })),
  ];
  return (
    <ActionLogPanel
      refreshKey={version}
      onUnauthorized={onUnauthorized}
      verbs={VERBS}
      load={async (_before, signal) => {
        const { entries, limit } = await fetchVehicleLog(signal);
        return legacyPage(entries, limit, (e) =>
          legacyRows(
            // 停用 / 恢复也走「变了的字段」那条路（旧页面就是这样显示的）。
            { ...e, action: e.action === "create" ? "create" : "update" },
            {
              fields,
              // 自加列原来是空的：只写新值（同旧页面）。
              omitFrom: (k, before) => k.startsWith(COL_PREFIX) && before[k] === "",
            },
          ).map((row) => ({ ...row, action: e.action })),
        );
      }}
    />
  );
}
