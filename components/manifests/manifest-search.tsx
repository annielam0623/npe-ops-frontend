"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchManifestSearchIndex,
  type ManifestSearchEntry,
} from "@/lib/manifests-api";
import { cn } from "@/lib/utils";

/** 最多列几条（再多就让 staff 多打几个字）。 */
const MAX_RESULTS = 20;

/**
 * 按单号 / 姓名 / 邮箱 / 电话找这一天的订单。电话只比数字（打 3 位以上才比），
 * 单号开头对上的排最前。少于 2 个字不搜。
 */
export function matchEntries(
  entries: readonly ManifestSearchEntry[],
  query: string,
): ManifestSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const hits = entries.filter(
    (e) =>
      e.order_number.toLowerCase().includes(q) ||
      e.guest_name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (digits.length >= 3 && e.phone.replace(/\D/g, "").includes(digits)),
  );
  const rank = (e: ManifestSearchEntry) =>
    e.order_number.toLowerCase().startsWith(q) ? 0 : 1;
  return hits.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_RESULTS);
}

type IndexState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; entries: ManifestSearchEntry[] }
  | { kind: "error"; message: string };

/**
 * Manifests 页的搜索框（ops 才有，旧页面没有）：搜这一天两个标签、全部胶囊；点结果跳到那一单所在的标签 / 胶囊并标出那一行。
 * 第一次打字时才拉索引（每颗胶囊一次请求）；换日期或页面重拉（`version` 变了）后下一次打字重拉。
 */
export function ManifestSearch({
  date,
  version,
  onJump,
  onUnauthorized,
  inputClassName,
}: {
  date: string;
  version: number;
  onJump: (entry: ManifestSearchEntry) => void;
  onUnauthorized: () => void;
  inputClassName: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<IndexState>({ kind: "idle" });
  const boxRef = useRef<HTMLDivElement>(null);
  /** 正在拉的索引：只在换日期 / 重拉 / 离开页面时取消（不能跟着 index 状态变化取消，否则刚发出去就被自己取消）。 */
  const requestRef = useRef<AbortController | null>(null);

  // 换日期 / 重拉：旧索引作废（换日期顺带清掉搜索词）。
  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIndex({ kind: "idle" });
  }, [version]);
  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIndex({ kind: "idle" });
    setQuery("");
    setOpen(false);
  }, [date]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const wanted = open && query.trim().length >= 2;
  useEffect(() => {
    if (!wanted || !date || index.kind !== "idle") return;
    const controller = new AbortController();
    requestRef.current = controller;
    setIndex({ kind: "loading" });
    fetchManifestSearchIndex(date, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setIndex({ kind: "ready", entries });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setIndex({ kind: "error", message: describeError(error) });
      });
  }, [wanted, date, index.kind, onUnauthorized]);

  // 点框外面收起。
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const results =
    index.kind === "ready" ? matchEntries(index.entries, query) : [];

  function pick(entry: ManifestSearchEntry) {
    setOpen(false);
    onJump(entry);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="search"
        role="combobox"
        aria-expanded={wanted}
        aria-controls="manifest-search-results"
        aria-label="Search this day's orders"
        placeholder="Search order #, name, phone, email…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (!results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[Math.min(active, results.length - 1)]);
          }
        }}
        className={inputClassName}
      />
      {wanted ? (
        <div
          id="manifest-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute top-full left-0 z-30 mt-1 max-h-[360px] w-[380px] overflow-y-auto rounded-[10px] border border-white/10 bg-[#0b1626] py-1 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,.45)]"
        >
          {index.kind === "loading" || index.kind === "idle" ? (
            <p className="px-3 py-2 text-[#94a3b8]">Searching this day…</p>
          ) : index.kind === "error" ? (
            <p role="alert" className="px-3 py-2 text-[#fca5a5]">
              Could not search: {index.message}
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-[#94a3b8]">
              No order on this day matches. Check the date.
            </p>
          ) : (
            results.map((e, i) => (
              <button
                key={e.row_key}
                type="button"
                role="option"
                aria-selected={i === active}
                data-result={e.row_key}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(e)}
                className={cn(
                  "block w-full px-3 py-1.5 text-left",
                  i === active ? "bg-white/[.08]" : "hover:bg-white/[.06]",
                )}
              >
                <span className="font-semibold text-[#f8fafc]">
                  {e.order_number}
                </span>
                <span className="text-[#cbd5e1]">
                  {e.guest_name ? ` · ${e.guest_name}` : ""}
                  {e.pax !== null ? ` · ${e.pax} pax` : ""}
                </span>
                <span className="block text-[11px] text-[#94a3b8]">
                  {e.tabLabel} › {e.pillLabel || "—"}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
