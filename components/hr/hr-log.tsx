"use client";

import { useEffect, useRef, useState } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { isStatus } from "@/lib/api-errors";
import { fetchHRLog, HR_LOG_LIMIT } from "@/lib/hr-api";
import type { HRLogEntry } from "@/types";

import { fieldLabel } from "./fields";
import {
  HR_BTN_CLASS,
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
  HR_EMPTY_CLASS,
} from "./legacy-ui";

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
    <section className={HR_CARD_CLASS}>
      <div className={HR_CARD_HEADER_CLASS}>
        <h2 className={HR_CARD_TITLE_CLASS}>Action Log</h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={HR_BTN_CLASS}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open ? (
        <>
          {/* .log-note */}
          <div className={LOG_NOTE_CLASS}>
            Records which fields changed and who changed them — never the values
            themselves.
          </div>
          {state.kind === "loading" || state.kind === "idle" ? (
            <div className={HR_EMPTY_CLASS}>Loading…</div>
          ) : state.kind === "error" ? (
            <div className={HR_EMPTY_CLASS}>Could not load the log.</div>
          ) : state.entries.length === 0 ? (
            <div className={HR_EMPTY_CLASS}>No activity yet.</div>
          ) : (
            <>
              <ul>
                {state.entries.map((e) => (
                  <li
                    key={e.id}
                    className="border-b-[0.5px] border-black/[.06] px-3 py-[9px] text-[12.5px] [overflow-wrap:anywhere] text-[#1a1a1a]"
                  >
                    <b>{e.label}</b> — {describeEntry(e)}
                    <div className="text-[11.5px] text-[#888]">
                      {e.actor_name || e.actor || "unknown"}
                      {e.created_at ? ` · ${formatLogTime(e.created_at)}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
              {state.entries.length >= HR_LOG_LIMIT ? (
                <div className={LOG_NOTE_CLASS}>
                  Showing the most recent {HR_LOG_LIMIT}.
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

/** .log-note */
const LOG_NOTE_CLASS =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-2.5 text-[11.5px] text-[#888]";

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
