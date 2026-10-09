"use client";

import { useEffect, useRef, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { fetchPickupLog, PICKUP_LOG_LIMIT } from "@/lib/pickup-locations-api";
import {
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
} from "@/components/ui/white-card";
import { cn } from "@/lib/utils";
import type { PickupLogEntry } from "@/types";

import { formatLogTime, LOG_FIELDS, LOG_VERB, logValue } from "./config";

/** .log-status */
const LOG_STATUS = "p-[18px] text-center text-xs text-[#bbb]";
/** .log-field（一行「字段: 旧 → 新」） */
const LOG_FIELD =
  "mt-[3px] ml-3.5 flex flex-wrap gap-1 leading-[1.55] text-[#666] [overflow-wrap:anywhere]";

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
    <section className={CARD_CLASS}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          CARD_HEADER_CLASS,
          "w-full cursor-pointer text-left select-none",
        )}
      >
        <span className={CARD_TITLE_CLASS}>
          <span aria-hidden>{open ? "▾" : "▸"}</span> Action Log
        </span>
        <span className="text-[11px] text-[#999]">Click to expand</span>
      </button>
      {open ? (
        state.kind === "loading" || state.kind === "idle" ? (
          <p className={LOG_STATUS}>Loading…</p>
        ) : state.kind === "error" ? (
          <p className={LOG_STATUS}>
            Could not load the action log. Please try again.
          </p>
        ) : state.entries.length === 0 ? (
          <p className={LOG_STATUS}>
            No changes recorded yet. Logging started Aug 21, 2026.
          </p>
        ) : (
          <>
            <ul>
              {state.entries.map((entry) => (
                <LogItem key={entry.id} entry={entry} />
              ))}
            </ul>
            {state.entries.length >= PICKUP_LOG_LIMIT ? (
              <p
                className={cn(
                  LOG_STATUS,
                  "border-t-[0.5px] border-black/[.06]",
                )}
              >
                Showing the {PICKUP_LOG_LIMIT} most recent changes.
              </p>
            ) : null}
          </>
        )
      ) : null}
    </section>
  );
}

function LogItem({ entry }: { entry: PickupLogEntry }) {
  const verb = LOG_VERB[entry.action] ?? {
    label: entry.action,
    className: "bg-[#e3f2fd] text-[#1565c0]",
  };
  const who = entry.actor_name || entry.actor || "Unknown";
  return (
    // 同旧页面 .log-row / .log-meta：谁 · 什么时候 [动作] 哪一家，一行放下。
    <li className="border-b-[0.5px] border-black/[.06] px-4 py-2.5 text-xs last:border-b-0">
      <div className="mb-[3px] text-[11px] text-[#999]">
        <b className="font-semibold text-[#1a1a1a]">{who}</b> ·{" "}
        {formatLogTime(entry.created_at)}
        <span
          className={cn(
            "mr-[5px] ml-2 inline-block rounded-[5px] px-[7px] py-px align-[1px] text-[10px] font-semibold",
            verb.className,
          )}
        >
          {verb.label}
        </span>
        <span className="text-xs font-semibold text-[#1a1a1a]">
          {entry.label}
        </span>
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
      <p className={LOG_FIELD}>
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
      <dl>
        {changed.map((f) => (
          <div key={f.key} className={LOG_FIELD}>
            <dt className="font-medium text-[#999]">{f.label}:</dt>
            <dd>
              <span className="text-[#c0392b] line-through">
                {logValue(before[f.key]) || "(empty)"}
              </span>{" "}
              →{" "}
              <span className="text-[#2e7d32]">
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
    <dl>
      {fields.map((f) => (
        <div key={f.key} className={LOG_FIELD}>
          <dt className="font-medium text-[#999]">{f.label}:</dt>
          <dd className="whitespace-pre-wrap">
            {logValue(source[f.key]) || <i className="text-[#bbb]">(empty)</i>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
