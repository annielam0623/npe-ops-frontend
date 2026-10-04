"use client";

import { useEffect, useRef, useState } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { isStatus } from "@/lib/api-errors";
import { fetchHRLog, HR_LOG_LIMIT } from "@/lib/hr-api";
import type { HRLogEntry } from "@/types";

import { fieldLabel } from "./fields";

type LogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: HRLogEntry[] };

/** 改动记录（只记哪些字段、谁改的，不记值），默认收起；version 变了就重拉。 */
export function HRLog({
  version,
  onUnauthorized,
}: {
  version: number;
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
    fetchHRLog(controller.signal)
      .then((entries) => {
        loadedVersionRef.current = version;
        setState({ kind: "ready", entries });
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

  return (
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-stone-50"
      >
        <span aria-hidden className="text-stone-500">
          {open ? "▾" : "▸"}
        </span>
        <span className="text-sm font-semibold text-stone-900">Action Log</span>
        <span className="text-xs text-stone-400">
          Records which fields changed and who changed them — never the values
          themselves.
        </span>
      </button>
      {open ? (
        <div className="border-t border-stone-200 px-4 py-3 text-sm">
          {state.kind === "loading" || state.kind === "idle" ? (
            <p className="text-stone-500">Loading…</p>
          ) : state.kind === "error" ? (
            <p className="text-red-700">Could not load the log.</p>
          ) : state.entries.length === 0 ? (
            <p className="text-stone-500">No activity yet.</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-stone-100">
                {state.entries.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 py-2">
                    <p className="[overflow-wrap:anywhere]">
                      <b className="text-stone-900">{e.label}</b> —{" "}
                      {describeEntry(e)}
                    </p>
                    <p className="text-xs text-stone-500">
                      {e.actor_name || e.actor || "unknown"}
                      {e.created_at ? ` · ${formatLogTime(e.created_at)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              {state.entries.length >= HR_LOG_LIMIT ? (
                <p className="mt-2 text-xs text-stone-500">
                  Showing the most recent {HR_LOG_LIMIT}.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
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
