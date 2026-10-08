"use client";

import { useEffect, useRef, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { fetchPickupLog, PICKUP_LOG_LIMIT } from "@/lib/pickup-locations-api";
import { cn } from "@/lib/utils";

import { CARD_CLASS, LogToggle } from "./legacy-ui";
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
    <section className={CARD_CLASS}>
      <LogToggle
        open={open}
        onToggle={() => setOpen((o) => !o)}
        hideHintWhenOpen
      />
      {open ? (
        <div>
          {state.kind === "loading" || state.kind === "idle" ? (
            <p className={LOG_STATUS_CLASS}>Loading…</p>
          ) : state.kind === "error" ? (
            <p className={LOG_STATUS_CLASS}>
              Could not load the action log. Please try again.
            </p>
          ) : state.entries.length === 0 ? (
            <p className={LOG_STATUS_CLASS}>
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
                    LOG_STATUS_CLASS,
                    "border-t-[0.5px] border-black/[.06]",
                  )}
                >
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

/** .log-status */
const LOG_STATUS_CLASS = "p-[18px] text-center text-[12px] text-[#bbb]";
/** .log-field */
const LOG_FIELD_CLASS =
  "mt-[3px] ml-3.5 leading-[1.55] break-words text-[#666]";
/** .log-field b */
const LOG_KEY_CLASS = "mr-1 font-medium text-[#999]";

function LogItem({ entry }: { entry: PickupLogEntry }) {
  const verb = LOG_VERB[entry.action] ?? {
    label: entry.action,
    className: LOG_VERB.update.className,
  };
  const who = entry.actor_name || entry.actor || "Unknown";
  return (
    <li className="border-b-[0.5px] border-black/[.06] px-4 py-2.5 text-[12px] last:border-b-0">
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
        <span className="text-[12px] font-semibold text-[#1a1a1a]">
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
    const [from, to] =
      entry.action === "deactivate"
        ? ["Active", "Inactive"]
        : ["Inactive", "Active"];
    return (
      <div className={LOG_FIELD_CLASS}>
        <span className="text-[#c0392b] line-through">{from}</span> →{" "}
        <span className="text-[#2e7d32]">{to}</span>
      </div>
    );
  }
  if (entry.action === "update") {
    const changed = LOG_FIELDS.filter(
      (f) => logValue(before[f.key]) !== logValue(after[f.key]),
    );
    return (
      <>
        {changed.map((f) => (
          <div key={f.key} className={LOG_FIELD_CLASS}>
            <b className={LOG_KEY_CLASS}>{f.label}:</b>
            <span className="text-[#c0392b] line-through">
              <LogValue value={logValue(before[f.key])} />
            </span>{" "}
            →{" "}
            <span className="text-[#2e7d32]">
              <LogValue value={logValue(after[f.key])} />
            </span>
          </div>
        ))}
      </>
    );
  }
  // create 只列有值的；delete 列全部（方便照着重建）。
  const source = entry.action === "delete" ? before : after;
  const fields =
    entry.action === "delete"
      ? LOG_FIELDS
      : LOG_FIELDS.filter((f) => logValue(source[f.key]));
  return (
    <>
      {fields.map((f) => (
        <div key={f.key} className={cn(LOG_FIELD_CLASS, "whitespace-pre-wrap")}>
          <b className={LOG_KEY_CLASS}>{f.label}:</b>
          <LogValue value={logValue(source[f.key])} />
        </div>
      ))}
    </>
  );
}

/** 空值写斜体浅灰 (empty)（同旧页面 logValue）。 */
function LogValue({ value }: { value: string }) {
  return value ? <>{value}</> : <i className="text-[#bbb]">(empty)</i>;
}
