"use client";

import { usePathname } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

import { LookupBody, useOrderLookup } from "./order-lookup-result";

/**
 * 整站顶栏的订单搜索（Annie 2026-10-14：用原来右上角那个假搜索框的位置）。输入单号回车，
 * 顶栏下面弹出面板：订单详情 + 这单在三个 Tracking 页的现状。点面板外面、按 Esc、换页都关上；再点输入框重新打开上次的结果。
 * 宽屏（xl）是原来那个框的大小；窄一点只露一个 ⌕ 键，点了在顶栏上展开输入框。
 */
export function TopOrderSearch() {
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  /** 窄屏：输入框展开了没有。 */
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, search, clear } = useOrderLookup(() => {
    window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
  });

  // 换页（面板里点了 Order details / Open tracking）就关。
  useEffect(() => {
    setOpen(false);
    setExpanded(false);
  }, [pathname]);

  useEffect(() => {
    if (!open && !expanded) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setExpanded(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, expanded]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setOpen(true);
    void search(input);
  }

  return (
    <div ref={rootRef} data-top-order-search>
      <button
        type="button"
        aria-label="Search order"
        onClick={() => {
          setExpanded(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={cn(
          "flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[.04] text-[15px] text-[#94a3b8] hover:text-white xl:hidden",
          expanded && "hidden",
        )}
      >
        ⌕
      </button>
      <form
        onSubmit={submit}
        role="search"
        className={cn(
          "h-10 items-center gap-2.5 rounded-xl border border-white/10 px-[13px] text-[13px] focus-within:border-white/30 xl:static xl:flex xl:w-80",
          // 窄屏展开时盖住整个顶栏的一行。
          expanded
            ? "fixed inset-x-4 top-3 z-50 flex bg-[#0b1726]"
            : "hidden bg-white/[.04]",
        )}
      >
        <span aria-hidden className="text-[#94a3b8]">
          ⌕
        </span>
        <input
          ref={inputRef}
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => state.kind !== "idle" && setOpen(true)}
          placeholder="Search order # (CHD# / Rezdy #)"
          aria-label="Order number"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[#f8fafc] outline-none placeholder:text-[#94a3b8] [&::-webkit-search-cancel-button]:appearance-none"
        />
      </form>

      {open && state.kind !== "idle" ? (
        <div
          role="dialog"
          aria-label="Order lookup"
          data-order-lookup
          className="fixed top-[72px] right-4 z-50 max-h-[calc(100vh-88px)] w-[min(980px,calc(100vw-32px))] overflow-y-auto rounded-[16px] border border-white/15 bg-[#0b1726] p-4 shadow-[0_24px_60px_rgba(0,0,0,.55)] sm:right-7"
        >
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-[14px] font-semibold text-white/80">
              Order lookup
            </h2>
            <button
              type="button"
              onClick={() => {
                clear();
                setInput("");
                setOpen(false);
              }}
              className="ml-auto text-[12.5px] text-white/45 hover:text-white/80"
            >
              Clear
            </button>
            {/* Annie 2026-10-14：要一个看得见的关闭键（上下各一个，结果长时不用滚回顶上）。不用蓝色。 */}
            <button
              type="button"
              data-close-lookup
              onClick={() => setOpen(false)}
              className="flex h-8 items-center gap-1.5 rounded-[9px] border border-white/[.13] px-3 text-[12.5px] font-semibold text-white/75 hover:border-white/[.22] hover:bg-white/[.07] hover:text-white"
            >
              ✕ Close
            </button>
          </div>
          <LookupBody state={state} />
          {state.kind === "ready" ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                data-close-lookup
                onClick={() => setOpen(false)}
                className="flex h-8 items-center gap-1.5 rounded-[9px] border border-white/[.13] px-3 text-[12.5px] font-semibold text-white/75 hover:border-white/[.22] hover:bg-white/[.07] hover:text-white"
              >
                ✕ Close
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
