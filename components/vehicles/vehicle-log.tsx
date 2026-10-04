"use client";

import { useEffect, useRef, useState } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { isStatus } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { fetchVehicleLog } from "@/lib/vehicles-api";
import type { VehicleLogEntry } from "@/types";

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
];

const VERB: Record<string, { label: string; className: string }> = {
  create: { label: "Added", className: "bg-emerald-100 text-emerald-800" },
  update: { label: "Edited", className: "bg-sky-100 text-sky-800" },
  rename: { label: "Renumbered", className: "bg-amber-100 text-amber-900" },
  deactivate: {
    label: "Deactivated",
    className: "bg-stone-200 text-stone-700",
  },
  reactivate: {
    label: "Reactivated",
    className: "bg-emerald-100 text-emerald-800",
  },
};

function text(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "(empty)"
    : String(value);
}

/** 改动记录，默认收起；第一次展开才拉，version 变了就重拉。 */
export function VehicleLog({
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
            <p className="text-stone-500">No changes recorded yet.</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-stone-100">
                {state.entries.map((e) => (
                  <LogItem key={e.id} entry={e} />
                ))}
              </ul>
              {state.entries.length >= state.limit ? (
                <p className="mt-2 text-xs text-stone-500">
                  Showing the latest {state.limit} changes.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function LogItem({ entry }: { entry: VehicleLogEntry }) {
  const verb = VERB[entry.action] ?? {
    label: entry.action,
    className: "bg-stone-100 text-stone-700",
  };
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const fields = LABELS.filter(([k]) => k in after && after[k] !== before[k]);
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="font-semibold text-stone-800">
          {entry.actor_name || entry.actor || "Unknown"}
        </span>
        {entry.created_at ? (
          <span>· {formatLogTime(entry.created_at)}</span>
        ) : null}
        <span
          className={cn("rounded px-1.5 py-0.5 font-semibold", verb.className)}
        >
          {verb.label}
        </span>
        <span className="font-medium text-stone-800">{entry.label}</span>
      </div>
      {fields.length ? (
        <dl className="grid gap-0.5 text-xs">
          {fields.map(([k, label]) => (
            <div key={k} className="flex flex-wrap gap-1.5">
              <dt className="text-stone-500">{label}:</dt>
              <dd className="[overflow-wrap:anywhere]">
                {k in before ? (
                  <>
                    <span className="text-red-600 line-through">
                      {text(before[k])}
                    </span>{" "}
                    →{" "}
                  </>
                ) : null}
                <span className="text-emerald-700">{text(after[k])}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
