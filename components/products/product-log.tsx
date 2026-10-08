"use client";

import { useEffect, useRef, useState } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { CARD_CLASS, LogToggle } from "@/components/pickup-locations/legacy-ui";
import { isStatus } from "@/lib/api-errors";
import { fetchProductLog, PRODUCT_LOG_LIMIT } from "@/lib/products-api";
import { cn } from "@/lib/utils";
import type { ProductGroup, ProductLogEntry, TicketTourType } from "@/types";

import { typeLabel } from "./config";

type LogState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: ProductLogEntry[] };

// .log-badge.create（绿）/ .update（蓝）；停用、恢复同旧页面用 update 的蓝。
const VERB: Record<string, { label: string; className: string }> = {
  create: { label: "Added", className: "bg-[#e8f5e9] text-[#2e7d32]" },
  update: { label: "Changed", className: "bg-[#e3f2fd] text-[#1565c0]" },
  deactivate: {
    label: "Deactivated",
    className: "bg-[#e3f2fd] text-[#1565c0]",
  },
  reactivate: {
    label: "Reactivated",
    className: "bg-[#e3f2fd] text-[#1565c0]",
  },
};

const FIELDS: readonly { key: string; label: string }[] = [
  { key: "internal_name", label: "Internal name" },
  { key: "manifest_id", label: "Group" },
  { key: "booking_type", label: "Category" },
  { key: "ticket_tour_type", label: "Tour type" },
];

/** 改动记录，默认收起，第一次展开才拉；version 变了（有改动）就重拉。 */
export function ProductLog({
  version,
  groups,
  tourTypes,
  onUnauthorized,
}: {
  version: number;
  groups: ProductGroup[];
  tourTypes: TicketTourType[];
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
    if (key === "ticket_tour_type") {
      return (
        tourTypes.find((t) => t.key === String(value))?.label ?? String(value)
      );
    }
    return String(value);
  }

  return (
    <section className={CARD_CLASS}>
      <LogToggle
        open={open}
        onToggle={() => setOpen((o) => !o)}
        hideHintWhenOpen
      />
      {open ? (
        <div>
          {state.kind === "loading" ? (
            <p className={LOG_STATUS_CLASS}>Loading…</p>
          ) : state.kind === "error" ? (
            <p className={LOG_STATUS_CLASS}>
              Could not load the action log. Please try again.
            </p>
          ) : state.entries.length === 0 ? (
            <p className={LOG_STATUS_CLASS}>No changes recorded yet.</p>
          ) : (
            <>
              <ul>
                {state.entries.map((e) => {
                  const verb = VERB[e.action] ?? {
                    label: e.action,
                    className: VERB.update.className,
                  };
                  const before = e.before ?? {};
                  const after = e.after ?? {};
                  return (
                    <li
                      key={e.id}
                      className="border-b-[0.5px] border-black/[.06] px-4 py-2.5 text-[12px] last:border-b-0"
                    >
                      <div className="mb-[3px] text-[11px] text-[#999]">
                        <b className="font-semibold text-[#1a1a1a]">
                          {e.actor_name || e.actor || "Unknown"}
                        </b>{" "}
                        · {formatLogTime(e.created_at)}
                        <span
                          className={cn(
                            "mr-[5px] ml-2 inline-block rounded-[5px] px-[7px] py-px align-[1px] text-[10px] font-semibold",
                            verb.className,
                          )}
                        >
                          {verb.label}
                        </span>
                        <span className="text-[12px] font-semibold text-[#1a1a1a]">
                          {e.label}
                        </span>
                      </div>
                      {e.action === "deactivate" ||
                      e.action === "reactivate" ? (
                        <div className={LOG_FIELD_CLASS}>
                          <span className="text-[#c0392b] line-through">
                            {e.action === "deactivate" ? "Active" : "Inactive"}
                          </span>{" "}
                          →{" "}
                          <span className="text-[#2e7d32]">
                            {e.action === "deactivate" ? "Inactive" : "Active"}
                          </span>
                        </div>
                      ) : (
                        FIELDS.filter((f) =>
                          e.action === "create"
                            ? after[f.key] !== null &&
                              after[f.key] !== undefined &&
                              after[f.key] !== ""
                            : String(before[f.key] ?? "") !==
                              String(after[f.key] ?? ""),
                        ).map((f) => (
                          <div key={f.key} className={LOG_FIELD_CLASS}>
                            <b className="mr-1 font-medium text-[#999]">
                              {f.label}:
                            </b>
                            {e.action === "create" ? (
                              show(f.key, after[f.key])
                            ) : (
                              <>
                                <span className="text-[#c0392b] line-through">
                                  {show(f.key, before[f.key])}
                                </span>{" "}
                                →{" "}
                                <span className="text-[#2e7d32]">
                                  {show(f.key, after[f.key])}
                                </span>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </li>
                  );
                })}
              </ul>
              {state.entries.length >= PRODUCT_LOG_LIMIT ? (
                <p
                  className={cn(
                    LOG_STATUS_CLASS,
                    "border-t-[0.5px] border-black/[.06]",
                  )}
                >
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

/** .log-status */
const LOG_STATUS_CLASS = "p-[18px] text-center text-[12px] text-[#bbb]";
/** .log-field */
const LOG_FIELD_CLASS =
  "mt-[3px] ml-3.5 leading-[1.55] break-words text-[#666]";
