"use client";

import { useEffect, useRef, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { fetchPickupLog, PICKUP_LOG_LIMIT } from "@/lib/pickup-locations-api";
import { cn } from "@/lib/utils";
import type { PickupLogEntry } from "@/types";

import { formatLogTime, LOG_FIELDS, LOG_VERB, logValue } from "./config";

type LogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: PickupLogEntry[] };

/**
 * 改动记录，默认收起；第一次展开才拉。version 变了（有改动成功）就作废缓存，展开着的话立刻重拉。
 */
export function ActionLog({
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
    if (!open || loadedVersionRef.current === version) {
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchPickupLog(controller.signal)
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
    // 新请求开始时作废旧请求，旧的晚到也不会盖掉新的。
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
        {!open ? (
          <span className="text-xs text-stone-400">Click to expand</span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-stone-200 px-4 py-3 text-sm">
          {state.kind === "loading" || state.kind === "idle" ? (
            <p className="text-stone-500">Loading…</p>
          ) : state.kind === "error" ? (
            <p className="text-red-700">
              Could not load the action log. Please try again.
            </p>
          ) : state.entries.length === 0 ? (
            <p className="text-stone-500">
              No changes recorded yet. Logging started Aug 21, 2026.
            </p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-stone-100">
                {state.entries.map((entry) => (
                  <LogItem key={entry.id} entry={entry} />
                ))}
              </ul>
              {state.entries.length >= PICKUP_LOG_LIMIT ? (
                <p className="mt-2 text-xs text-stone-500">
                  Showing the {PICKUP_LOG_LIMIT} most recent changes.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function LogItem({ entry }: { entry: PickupLogEntry }) {
  const verb = LOG_VERB[entry.action] ?? {
    label: entry.action,
    className: "bg-stone-100 text-stone-700",
  };
  const who = entry.actor_name || entry.actor || "Unknown";
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="font-semibold text-stone-800">{who}</span>
        <span>· {formatLogTime(entry.created_at)}</span>
        <span
          className={cn("rounded px-1.5 py-0.5 font-semibold", verb.className)}
        >
          {verb.label}
        </span>
        <span className="font-medium text-stone-800">{entry.label}</span>
      </div>
      <LogDetail entry={entry} />
    </li>
  );
}

function LogDetail({ entry }: { entry: PickupLogEntry }) {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  if (entry.action === "deactivate" || entry.action === "reactivate") {
    return (
      <p className="text-xs text-stone-600">
        {entry.action === "deactivate"
          ? "Active → Inactive"
          : "Inactive → Active"}
      </p>
    );
  }
  if (entry.action === "update") {
    const changed = LOG_FIELDS.filter(
      (f) => logValue(before[f.key]) !== logValue(after[f.key]),
    );
    return (
      <dl className="grid gap-0.5 text-xs">
        {changed.map((f) => (
          <div key={f.key} className="flex flex-wrap gap-1.5">
            <dt className="text-stone-500">{f.label}:</dt>
            <dd className="[overflow-wrap:anywhere]">
              <span className="text-red-600 line-through">
                {logValue(before[f.key]) || "(empty)"}
              </span>{" "}
              →{" "}
              <span className="text-emerald-700">
                {logValue(after[f.key]) || "(empty)"}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  // create 只列有值的；delete 列全部（方便照着重建）。
  const source = entry.action === "delete" ? before : after;
  const fields =
    entry.action === "delete"
      ? LOG_FIELDS
      : LOG_FIELDS.filter((f) => logValue(source[f.key]));
  return (
    <dl className="grid gap-0.5 text-xs">
      {fields.map((f) => (
        <div key={f.key} className="flex flex-wrap gap-1.5">
          <dt className="text-stone-500">{f.label}:</dt>
          <dd className="[overflow-wrap:anywhere] whitespace-pre-wrap text-stone-800">
            {logValue(source[f.key]) || (
              <i className="text-stone-400">(empty)</i>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
