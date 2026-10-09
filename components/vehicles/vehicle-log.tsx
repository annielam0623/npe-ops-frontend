"use client";

import { useEffect, useRef, useState } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { isStatus } from "@/lib/api-errors";
import { fetchVehicleLog } from "@/lib/vehicles-api";
import type { VehicleColumn, VehicleLogEntry } from "@/types";

import { CARD_CLASS, CARD_HEADER_CLASS, CARD_TITLE_CLASS } from "./styles";

type LogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: VehicleLogEntry[]; limit: number };

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

/** 动作名（旧页面直接显示后端的原始动作，ops 写成过去式，见 PROGRESS「与旧页面的差异」）。 */
const VERB: Record<string, string> = {
  create: "Added",
  update: "Edited",
  rename: "Renumbered",
  deactivate: "Deactivated",
  reactivate: "Reactivated",
  "add column": "Added column",
  "rename column": "Renamed column",
  "hide column": "Hid column",
  "show column": "Showed column",
};

function text(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "(empty)"
    : String(value);
}

/** 改动记录，默认收起；第一次展开才拉，version 变了就重拉。 */
export function VehicleLog({
  version,
  columns,
  onUnauthorized,
}: {
  version: number;
  columns: VehicleColumn[];
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LogState>({ kind: "idle" });
  const loadedVersionRef = useRef<number | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    if (!open || loadedVersionRef.current === version) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchVehicleLog(controller.signal)
      .then(({ entries, limit }) => {
        loadedVersionRef.current = version;
        setState({ kind: "ready", entries, limit });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [open, version]);

  const status = "p-[18px] text-center text-xs text-[#999]";
  return (
    <section className={CARD_CLASS}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${CARD_HEADER_CLASS} w-full cursor-pointer text-left select-none`}
      >
        <span className={CARD_TITLE_CLASS}>
          <span aria-hidden>{open ? "▾" : "▸"}</span> Action Log
        </span>
        <span className="text-[11px] text-[#999]">Click to expand</span>
      </button>
      {open ? (
        state.kind === "loading" || state.kind === "idle" ? (
          <p className={status}>Loading…</p>
        ) : state.kind === "error" ? (
          <p className={status}>
            Could not load the action log. Please try again.
          </p>
        ) : state.entries.length === 0 ? (
          <p className={status}>No changes recorded yet.</p>
        ) : (
          <>
            <ul>
              {state.entries.map((e) => (
                <LogItem key={e.id} entry={e} columns={columns} />
              ))}
            </ul>
            {state.entries.length >= state.limit ? (
              <p className={status}>
                Showing the latest {state.limit} changes.
              </p>
            ) : null}
          </>
        )
      ) : null}
    </section>
  );
}

function LogItem({
  entry,
  columns,
}: {
  entry: VehicleLogEntry;
  columns: VehicleColumn[];
}) {
  const verb = VERB[entry.action] ?? entry.action;
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const colName = (id: string) =>
    columns.find((c) => String(c.id) === id)?.label ?? "Extra column";
  const fields: Array<[string, string]> = [
    ...LABELS,
    ...Object.keys(after)
      .filter((k) => k.startsWith(COL_PREFIX))
      .map((k) => [k, colName(k.slice(COL_PREFIX.length))] as [string, string]),
  ].filter(([k]) => k in after && after[k] !== before[k]);
  // 同旧页面 .log-row / .log-meta / .log-field。
  return (
    <li className="border-b-[0.5px] border-black/[.06] px-4 py-2.5 text-xs text-[#444] last:border-b-0">
      <div className="mb-[3px] text-[11px] text-[#888]">
        <b className="font-semibold text-[#1a1a1a]">
          {entry.actor_name || entry.actor || "Unknown"}
        </b>
        {entry.created_at ? ` · ${formatLogTime(entry.created_at)}` : null}
        {` · ${verb} `}
        <span className="text-xs font-semibold text-[#1a1a1a]">
          {entry.label}
        </span>
      </div>
      {fields.length ? (
        <dl>
          {fields.map(([k, label]) => (
            <div
              key={k}
              className="mt-[3px] ml-3.5 flex flex-wrap gap-1 leading-[1.55] [overflow-wrap:anywhere] text-[#666]"
            >
              <dt className="font-medium text-[#999]">{label}:</dt>
              <dd>
                {/* 自加列原来是空的：只写新值（同旧页面）。 */}
                {k in before &&
                !(k.startsWith(COL_PREFIX) && before[k] === "") ? (
                  <>
                    <span className="text-[#c0392b] line-through">
                      {text(before[k])}
                    </span>{" "}
                    →{" "}
                  </>
                ) : null}
                <span className="text-[#2e7d32]">{text(after[k])}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
