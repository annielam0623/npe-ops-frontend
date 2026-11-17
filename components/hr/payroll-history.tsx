"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatLogTime } from "@/components/pickup-locations/config";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchPayrollLog } from "@/lib/guide-payroll-api";
import { cn } from "@/lib/utils";
import type { PayrollLogEntry } from "@/types/guide-payroll";

import {
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
} from "./legacy-ui";
import {
  C_BTN,
  C_DIM,
  C_RED,
  C_STICKY,
  C_TABLE,
  C_TD,
  C_TH,
  C_WRAP,
} from "./payroll-cards-shared";

/**
 * Payroll › Change history 卡（138 乙，5a；V9 题 9 A）：页面最下面一张可展开的卡，
 * When / Who / What / Before / After，新的在上，先 5 条，「Show more」用 next_cursor 再拉更早的。
 * Payroll: View 也能看。version 变了（页面每次存好 +1）就从头重拉。
 */

const PAGE = 5;

/** from / to 是任意 JSON：字串原样，数字照写，布尔写 ticked / not ticked，其余压成一行。 */
function show(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "ticked" : "not ticked";
  if (Array.isArray(v)) return v.map((x) => show(x) ?? "—").join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${show(x) ?? "—"}`)
      .join(" · ");
  }
  return String(v);
}

export interface PayrollHistoryProps {
  canEdit: boolean;
  onUnauthorized: () => void;
  version: number;
}

export function PayrollHistory({
  onUnauthorized,
  version,
}: PayrollHistoryProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PayrollLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqRef = useRef(0);

  const fetchPage = useCallback(
    (before: string | null) => {
      const req = ++reqRef.current;
      setLoading(true);
      setErr(null);
      fetchPayrollLog(before, PAGE)
        .then((page) => {
          if (req !== reqRef.current) return;
          setEntries((cur) =>
            before ? [...cur, ...page.entries] : page.entries,
          );
          setCursor(page.next_cursor);
          setLoaded(true);
        })
        .catch((e: unknown) => {
          if (req !== reqRef.current) return;
          if (isStatus(e, 401)) {
            onUnauthorized();
            return;
          }
          setErr(describeError(e));
        })
        .finally(() => {
          if (req === reqRef.current) setLoading(false);
        });
    },
    [onUnauthorized],
  );

  // 打开时拉第一页；页面存好（version 变）后从头重拉。关着的时候不拉。
  useEffect(() => {
    if (open) fetchPage(null);
  }, [open, version, fetchPage]);

  return (
    <div className={HR_CARD_CLASS} data-payroll-history>
      <div className={HR_CARD_HEADER_CLASS}>
        <button
          type="button"
          aria-expanded={open}
          data-history-toggle
          onClick={() => setOpen((v) => !v)}
          className={cn(
            HR_CARD_TITLE_CLASS,
            "inline-flex cursor-pointer flex-wrap items-center gap-1.5 border-0 bg-transparent p-0 text-left",
          )}
        >
          <span className="w-3 text-[10px] text-[#4b5563]">
            {open ? "▼" : "▶"}
          </span>
          Change history
          <span className="font-normal text-[#4b5563]">
            · prices, extras, fees, tips and locks
          </span>
        </button>
      </div>
      {!open ? null : (
        <>
          {loaded && entries.length === 0 && !err ? (
            <div
              className="px-4 py-7 text-center text-[13px] text-[#4b5563]"
              data-history-empty
            >
              No changes yet.
            </div>
          ) : entries.length ? (
            <div className={cn(C_WRAP, "pt-3 pb-1")}>
              <table className={cn(C_TABLE, "min-w-[640px]")}>
                <thead>
                  <tr>
                    <th className={cn(C_TH, C_STICKY)}>When</th>
                    <th className={C_TH}>Who</th>
                    <th className={C_TH}>What</th>
                    <th className={C_TH}>Before</th>
                    <th className={C_TH}>After</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((h) => {
                    const what = [h.label, h.what].filter(Boolean).join(" · ");
                    const before = show(h.from);
                    const after = show(h.to);
                    return (
                      <tr key={h.id} className="bg-white" data-history-row>
                        <td className={cn(C_TD, C_STICKY, "whitespace-nowrap")}>
                          {h.at ? formatLogTime(h.at) : "—"}
                        </td>
                        <td className={C_TD}>{h.by ?? "—"}</td>
                        <td className={C_TD}>{what || h.action}</td>
                        <td className={C_TD}>
                          {before ?? <span className={C_DIM}>—</span>}
                        </td>
                        <td className={C_TD}>
                          {after ?? <span className={C_DIM}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : loading ? (
            <p className={cn(C_DIM, "m-0 px-4 py-6 text-center text-[13px]")}>
              Loading…
            </p>
          ) : null}
          {err ? (
            <p className={cn(C_RED, "m-0 px-4 py-2")} role="alert">
              {err}
            </p>
          ) : null}
          {cursor && entries.length ? (
            <div className="px-4 pt-1 pb-3.5 max-sm:px-3">
              <button
                type="button"
                className={C_BTN}
                disabled={loading}
                data-history-more
                onClick={() => fetchPage(cursor)}
              >
                {loading ? "Loading…" : "Show more"}
              </button>
            </div>
          ) : (
            <div className="h-2.5" />
          )}
        </>
      )}
    </div>
  );
}
