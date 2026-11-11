"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { canyonNoun, canyonSummary } from "./page-save";

/**
 * Bus Manifest 页头的 Canyon order（置顶 41，Annie 2026-11-01：「长期默认，第二个由staff来决定」「同意全部推荐」
 * 「给他们拖拽不是更好么」→ 选 A「两件都动手」；整页 preview https://claude.ai/artifact/Txr893UKjC71txRfFJkdfd ）：
 * 小框照纸分 PAGE 1 / PAGE 2 …，拖一个 canyon 上下换顺序，拖进另一页的框 = 印在那一页，拖到最下面的虚线框 = 新的一页；
 * 拖空的页自己消失。Annie 11-01 在 57 窗口改定「只管这一次」：拖的结果只在这一页、打印、下载用，不存、没有 Save；
 * 重开页面回默认（LOWER → UPPER → CANYON X、一页）。只看的人（partner 等）看到一行字。
 */
export function CanyonOrderPicker({
  pages,
  readOnly,
  onChange,
}: {
  pages: string[][];
  readOnly: boolean;
  onChange: (pages: string[][]) => void;
}) {
  // Antelope 叫 Canyon order；Hoover Dam（64：BUS TOUR / HD RAFT / BOULDER CITY 也出）叫 Section order。
  const noun = canyonNoun(pages.flat());
  const title = noun === "canyon" ? "Canyon order" : "Section order";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (readOnly)
    return (
      <span data-canyon-text className="text-[11.5px] text-[#cbd5e1]">
        {title}: {canyonSummary(pages)}
      </span>
    );
  return (
    <div ref={wrapRef} className="relative inline-flex">
      <span
        data-canyon-order
        className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-white/[.18] pr-1 pl-2.5 text-[11.5px] text-[#cbd5e1]"
      >
        {title}:
        <button
          type="button"
          data-canyon-open
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-5 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-[11.5px] font-semibold text-white"
        >
          {canyonSummary(pages)}
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path
              d="M1 1l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </button>
      </span>
      {open ? (
        <CanyonBox
          title={title}
          noun={noun}
          pages={pages}
          onChange={onChange}
          onDone={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** 把 key 挪到第 page 页的第 at 位（page = 页数 ⇒ 新起一页）；空页拿掉。 */
export function moveCanyon(
  pages: string[][],
  key: string,
  page: number,
  at: number,
): string[][] {
  const next = pages.map((p) => p.filter((x) => x !== key));
  if (page >= next.length) next.push([key]);
  else next[page].splice(at, 0, key);
  return next.filter((p) => p.length);
}

function CanyonBox({
  title,
  noun,
  pages,
  onChange,
  onDone,
}: {
  title: string;
  noun: "canyon" | "section";
  pages: string[][];
  onChange: (pages: string[][]) => void;
  onDone: () => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  /** 放下去的位置：第几页、第几位（-1 页 = 最下面的虚线框）。 */
  const [hover, setHover] = useState<{ page: number; at: number } | null>(null);
  const boxRefs = useRef<(HTMLDivElement | null)[]>([]);

  const indexAt = (page: number, y: number) => {
    const cards = [
      ...(boxRefs.current[page]?.querySelectorAll<HTMLElement>(
        "[data-canyon-card]",
      ) ?? []),
    ].filter((c) => c.dataset.canyonCard !== drag);
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i < 0 ? cards.length : i;
  };
  const drop = (page: number, at: number) => {
    if (drag) onChange(moveCanyon(pages, drag, page, at));
    setDrag(null);
    setHover(null);
  };

  return (
    <div
      data-canyon-box
      role="dialog"
      aria-label={title}
      className="absolute top-10 right-0 z-40 w-[320px] rounded-xl border border-white/15 bg-[#0c1828] px-3.5 pt-3.5 pb-3 text-left text-[12.5px] text-[#e2e8f0] shadow-[0_12px_34px_rgba(0,0,0,.55)]"
    >
      <h3 className="m-0 text-[13px] font-bold text-white">{title}</h3>
      <p className="mt-0.5 mb-3 text-[11.5px] leading-[1.45] text-[#7c8ba1]">
        Drag to change the order or the page. Used on this page and when you
        Print or Download. Not saved.
      </p>
      {pages.map((page, pi) => {
        const cards = page.filter((k) => k !== drag);
        const line = hover?.page === pi ? hover.at : -1;
        return (
          <div key={pi}>
            <div className="mb-1 text-[10.5px] font-bold tracking-[.06em] text-[#94a3b8]">
              PAGE {pi + 1}
            </div>
            <div
              ref={(el) => {
                boxRefs.current[pi] = el;
              }}
              data-canyon-page={pi}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const at = indexAt(pi, e.clientY);
                if (hover?.page !== pi || hover.at !== at)
                  setHover({ page: pi, at });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(pi, indexAt(pi, e.clientY));
              }}
              className={cn(
                "mb-2.5 flex min-h-10 flex-col gap-1.5 rounded-[9px] border p-1.5",
                hover?.page === pi
                  ? "border-white/45 bg-white/[.03]"
                  : "border-white/14",
              )}
            >
              {page.map((k) => {
                const at = cards.indexOf(k);
                return (
                  <div key={k} className="flex flex-col gap-1.5">
                    {line >= 0 && at === line ? <InsertLine /> : null}
                    <div
                      draggable
                      data-canyon-card={k}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", k);
                        // 等浏览器拍完拖动的影子再变淡。
                        setTimeout(() => setDrag(k), 0);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setHover(null);
                      }}
                      className={cn(
                        "flex cursor-grab items-center gap-2.5 rounded-lg border bg-white/[.06] px-[11px] py-[7px] select-none hover:bg-white/10",
                        drag === k
                          ? "border-dashed border-white/12 opacity-35"
                          : "border-white/12",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="w-3 text-[13px] tracking-[-2px] text-[#64748b]"
                      >
                        ⋮⋮
                      </span>
                      <span className="flex-1 font-semibold tracking-[.02em] text-white">
                        {k}
                      </span>
                    </div>
                  </div>
                );
              })}
              {line >= 0 && line === cards.length ? <InsertLine /> : null}
            </div>
          </div>
        );
      })}
      <div
        data-canyon-newpage
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          if (hover?.page !== -1) setHover({ page: -1, at: 0 });
        }}
        onDragLeave={() => hover?.page === -1 && setHover(null)}
        onDrop={(e) => {
          e.preventDefault();
          drop(pages.length, 0);
        }}
        className={cn(
          "rounded-[9px] border border-dashed p-2.5 text-center text-[11.5px]",
          hover?.page === -1
            ? "border-[#e2e8f0] bg-white/5 text-[#e2e8f0]"
            : "border-white/25 text-[#94a3b8]",
        )}
      >
        Drag a {noun} here to print it on a new page
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-[#7c8ba1]">
        <span>Shuttle sections stay at the end.</span>
        {/* Done 是白色（只关框，不是提交）：真正存在整页 Save。 */}
        <button
          type="button"
          data-canyon-done
          onClick={onDone}
          className="cursor-pointer rounded-[7px] border-0 bg-white px-3 py-1 text-[12px] font-semibold text-[#111827]"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function InsertLine() {
  return (
    <div
      data-canyon-insert
      className="mx-1 -my-1 h-0 rounded-sm border-t-2 border-[#e2e8f0]"
    />
  );
}
