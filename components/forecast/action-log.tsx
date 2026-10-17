"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DarkPanel } from "@/components/ui/dark-page";
import { describeError } from "@/lib/api-errors";
import { fetchForecastLog } from "@/lib/forecast-api";
import type { ForecastLogItem } from "@/types";

import { formatLongDate, formatMetaTime } from "./config";

const PAGE_SIZE = 50;

/**
 * 表底部的 Action Log（G81）：默认收起，展开才去拉；最近 50 条新的在上，Show more 往前翻。
 * 本版只记按天改的开关团和每档上限（手写格子、导游排班不在里面）。
 * refreshKey 变了（表上刚存了一处）且已展开 ⇒ 重新拉第一页。
 */
export function ActionLog({ refreshKey }: { refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ForecastLogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (before: string | null) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchForecastLog(before, PAGE_SIZE, controller.signal);
      if (controller.signal.aborted) return;
      setItems((prev) => (before ? [...prev, ...page.items] : page.items));
      setCursor(page.next_cursor);
      setLoaded(true);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(describeError(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load(null);
    return () => controllerRef.current?.abort();
  }, [open, refreshKey, load]);

  return (
    <DarkPanel>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold">Action Log</span>
        <span className="text-xs text-white/50">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? (
        <div data-action-log className="mt-3">
          {error ? (
            <p
              role="alert"
              className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200"
            >
              Could not load the log: {error}{" "}
              <button
                type="button"
                onClick={() => void load(null)}
                className="underline"
              >
                Retry
              </button>
            </p>
          ) : null}
          {loaded && !items.length && !error ? (
            <p className="text-sm text-white/50">Nothing has been changed yet.</p>
          ) : null}
          {items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-white/45">
                    {["When", "Who", "Tour", "Day", "What", "From → To"].map(
                      (h) => (
                        <th key={h} className="px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={`${item.at}:${i}`} className="border-t border-white/10">
                      <td className="px-2 py-1.5 whitespace-nowrap text-white/70">
                        {formatMetaTime(item.at)}
                      </td>
                      <td className="px-2 py-1.5">{item.by}</td>
                      <td className="px-2 py-1.5">{item.tour}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {item.date ? formatLongDate(item.date) : "—"}
                      </td>
                      <td className="px-2 py-1.5">{item.what}</td>
                      <td className="px-2 py-1.5">
                        {item.from || item.to ? (
                          <>
                            <span className="text-white/60">
                              {item.from || "—"}
                            </span>{" "}
                            <span className="text-white/35">→</span>{" "}
                            {item.to || "—"}
                          </>
                        ) : (
                          <span className="text-white/35">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {loading && !items.length ? (
            <p className="text-sm text-white/50">Loading...</p>
          ) : null}
          {cursor ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(cursor)}
              className="mt-3 h-7 rounded-[7px] border border-white/18 px-3 text-[12px] text-[#cbd5e1] hover:bg-white/[.07] disabled:opacity-50"
            >
              {loading ? "Loading..." : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </DarkPanel>
  );
}
