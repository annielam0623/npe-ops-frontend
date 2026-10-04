"use client";

import { useEffect, useRef, useState } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { isStatus } from "@/lib/api-errors";
import { fetchProductLog, PRODUCT_LOG_LIMIT } from "@/lib/products-api";
import { cn } from "@/lib/utils";
import type { ProductGroup, ProductLogEntry } from "@/types";

import { typeLabel } from "./config";

type LogState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: ProductLogEntry[] };

const VERB: Record<string, { label: string; className: string }> = {
  create: { label: "Added", className: "bg-emerald-100 text-emerald-800" },
  update: { label: "Changed", className: "bg-blue-100 text-blue-800" },
  deactivate: { label: "Deactivated", className: "bg-blue-100 text-blue-800" },
  reactivate: { label: "Reactivated", className: "bg-blue-100 text-blue-800" },
};

const FIELDS: readonly { key: string; label: string }[] = [
  { key: "internal_name", label: "Internal name" },
  { key: "manifest_id", label: "Group" },
  { key: "booking_type", label: "Category" },
];

/** 改动记录，默认收起，第一次展开才拉；version 变了（有改动）就重拉。 */
export function ProductLog({
  version,
  groups,
  onUnauthorized,
}: {
  version: number;
  groups: ProductGroup[];
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LogState>({ kind: "loading" });
  const loadedVersionRef = useRef<number | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    if (!open || loadedVersionRef.current === version) {
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchProductLog(controller.signal)
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

  /** 组 id 换成现在的组名，找不到写 group #id。 */
  function show(key: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "(blank)";
    if (key === "manifest_id") {
      const g = groups.find((x) => String(x.id) === String(value));
      return g ? g.display_name || g.name : `group #${String(value)}`;
    }
    if (key === "booking_type") return typeLabel(String(value));
    return String(value);
  }

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
          {state.kind === "loading" ? (
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
                {state.entries.map((e) => {
                  const verb = VERB[e.action] ?? {
                    label: e.action,
                    className: "bg-stone-100 text-stone-700",
                  };
                  const before = e.before ?? {};
                  const after = e.after ?? {};
                  return (
                    <li key={e.id} className="flex flex-col gap-1 py-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                        <span className="font-semibold text-stone-800">
                          {e.actor_name || e.actor || "Unknown"}
                        </span>
                        <span>· {formatLogTime(e.created_at)}</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-semibold",
                            verb.className,
                          )}
                        >
                          {verb.label}
                        </span>
                        <span className="font-mono text-stone-800">
                          {e.label}
                        </span>
                      </div>
                      {e.action === "deactivate" ||
                      e.action === "reactivate" ? (
                        <p className="text-xs text-stone-600">
                          {e.action === "deactivate"
                            ? "Active → Inactive"
                            : "Inactive → Active"}
                        </p>
                      ) : (
                        <dl className="grid gap-0.5 text-xs">
                          {FIELDS.filter((f) =>
                            e.action === "create"
                              ? after[f.key] !== null &&
                                after[f.key] !== undefined &&
                                after[f.key] !== ""
                              : String(before[f.key] ?? "") !==
                                String(after[f.key] ?? ""),
                          ).map((f) => (
                            <div key={f.key} className="flex flex-wrap gap-1.5">
                              <dt className="text-stone-500">{f.label}:</dt>
                              <dd className="[overflow-wrap:anywhere]">
                                {e.action === "create" ? (
                                  <span className="text-stone-800">
                                    {show(f.key, after[f.key])}
                                  </span>
                                ) : (
                                  <>
                                    <span className="text-red-600 line-through">
                                      {show(f.key, before[f.key])}
                                    </span>{" "}
                                    →{" "}
                                    <span className="text-emerald-700">
                                      {show(f.key, after[f.key])}
                                    </span>
                                  </>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>
              {state.entries.length >= PRODUCT_LOG_LIMIT ? (
                <p className="mt-2 text-xs text-stone-500">
                  Showing the {PRODUCT_LOG_LIMIT} most recent changes.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
