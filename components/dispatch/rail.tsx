"use client";

import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import type { Analysis } from "./config";

/** 多于这个数的酒店名单收起来，点 View 才展开。 */
const NAMES_INLINE_MAX = 4;
const OPEN_KEY = "dispatch-schedule-check-open";
/** 宽屏（右边放得下浮窗而不盖住内容）默认展开，窄屏默认折成胶囊。 */
export const WIDE_PX = 1301;

/**
 * 浮窗展开 / 折起（Annie 2026-10-17 夜）：记在这个浏览器里，没记过就按屏幕宽度（宽屏展开、窄屏折起）。
 * 第一次渲染先按折起（和服务端一致），挂上以后再读。
 */
export function useCheckOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let pref: string | null = null;
    try {
      pref = window.localStorage.getItem(OPEN_KEY);
    } catch {}
    setOpen(pref ? pref === "1" : window.innerWidth >= WIDE_PX);
  }, []);
  const toggle = useCallback(() => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {}
      return !o;
    });
  }, []);
  return [open, toggle];
}

/**
 * Schedule check 浮窗：固定在屏幕右边，跟着屏幕走；可折成右下角的小胶囊（⚠ N issues / ✓ All good）。
 * 一件事都不拦（只有「没司机」真的拦保存，那条在这里也列出来）。
 * 问题后面的「Fix ›」带你到出问题的那台车 / 那一块（框闪黄 2 秒），不会自己改什么。
 * 当天没客人的巴士团（也没排车）沉在最下面一块、默认折起：不用管。
 */
export function Rail({
  analysis,
  guests,
  open,
  onToggle,
  onGoto,
  onGoSection,
}: {
  analysis: Analysis;
  /** 巴士团这一天有几位客人（Step 1 卡片）：键 = 块的 key。没有 = 不是巴士团 / 卡片还没读到，照常显示。 */
  guests: Record<string, number>;
  open: boolean;
  onToggle: () => void;
  onGoto: (idx: number, field?: string) => void;
  onGoSection: (key: string) => void;
}) {
  const [names, setNames] = useState<Record<string, boolean>>({});
  const [quietOpen, setQuietOpen] = useState(false);
  const n = analysis.issues.length;

  if (!open)
    return (
      <button
        type="button"
        data-schedule-pill
        onClick={onToggle}
        aria-label="Open Schedule check"
        className={cn(
          "fixed right-[calc(72px+env(safe-area-inset-right,0px))] bottom-[max(16px,env(safe-area-inset-bottom,0px))] z-40 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-bold shadow-[0_6px_20px_rgba(0,0,0,.35)]",
          n
            ? "border-[#fbbf24] bg-[#fbbf24] text-[#1a1a1a] hover:bg-[#fcd34d]"
            : "border-[#4ade80] bg-[#4ade80] text-[#0b1f12] hover:bg-[#86efac]",
        )}
      >
        {n ? `⚠ ${n} ${n === 1 ? "issue" : "issues"}` : "✓ All good"}
      </button>
    );

  const quiet = analysis.sections.filter(
    (s) => guests[s.key] === 0 && s.vans === 0,
  );
  const shown = analysis.sections.filter((s) => !quiet.includes(s));
  return (
    <aside
      id="schedule-check"
      aria-label="Schedule check"
      className="fixed top-20 right-[max(16px,env(safe-area-inset-right,0px))] z-40 max-h-[calc(100vh-210px)] w-[312px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[14px] border border-white/15 bg-[#0c1828] p-4 shadow-[0_10px_30px_rgba(0,0,0,.45)]"
    >
      <div className="mb-[3px] flex items-center justify-between gap-2">
        <h2 className="m-0 text-[13px] font-[650] tracking-[-.01em] text-white">
          Schedule check
        </h2>
        <button
          type="button"
          data-schedule-collapse
          onClick={onToggle}
          className="cursor-pointer rounded-md border border-white/15 bg-white/[.05] px-2 py-0.5 text-[11.5px] font-semibold text-[#cbd5e1] hover:bg-white/[.1]"
        >
          Collapse ▾
        </button>
      </div>
      <p className="m-0 mb-3.5 text-[11.5px] text-[#64748b]">
        Nothing here stops you from saving.
      </p>
      {n ? (
        <ul aria-label="Issues" className={GRP}>
          {analysis.issues.map((it, i) => {
            const list = it.names ?? [];
            const collapsed =
              list.length > NAMES_INLINE_MAX && !names[it.namesKey ?? ""];
            const fix =
              typeof it.idx === "number"
                ? () => onGoto(it.idx!, it.field)
                : it.sec
                  ? () => onGoSection(it.sec!)
                  : null;
            return (
              <li key={i} className="flex items-start gap-2.5">
                <Mark kind="warn" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className={T}>{it.title}</span>
                      {it.detail ? (
                        <span className={D}>{it.detail}</span>
                      ) : null}
                    </span>
                    {fix ? (
                      <button
                        type="button"
                        data-issue-fix
                        onClick={fix}
                        className="flex-none cursor-pointer rounded-md border-0 bg-transparent px-1 py-0.5 text-[12px] font-semibold whitespace-nowrap text-[#93c5fd] hover:bg-white/[.07] hover:text-white"
                      >
                        Fix ›
                      </button>
                    ) : null}
                  </span>
                  {list.length ? (
                    list.length > NAMES_INLINE_MAX ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setNames((o) => ({
                              ...o,
                              [it.namesKey ?? ""]: !o[it.namesKey ?? ""],
                            }))
                          }
                          className="mt-[9px] inline-flex items-center gap-1.5 rounded-lg border border-white/16 bg-white/[.04] px-[11px] py-[5px] text-[11.5px] font-semibold text-[#cbd5e1] hover:bg-white/[.09] hover:text-white"
                        >
                          {collapsed ? (
                            <>
                              View {list.length} hotels
                              <span className="text-[12px] text-[#94a3b8]">
                                ›
                              </span>
                            </>
                          ) : (
                            "Hide ‹"
                          )}
                        </button>
                        {!collapsed ? (
                          <span className={NAMES}>{list.join(" · ")}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className={NAMES}>{list.join(" · ")}</span>
                    )
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ul className={GRP}>
        {shown.map((s) => {
          const g = guests[s.key];
          const needs = g != null && g > 0 && s.vans === 0;
          return (
            <li key={s.key} className="flex items-start gap-2.5">
              <Mark kind={needs ? "warn" : s.vans ? "good" : "idle"} />
              <span className="min-w-0 flex-1">
                <span className={T}>
                  {s.name} {s.when}
                </span>
                <span className={cn(D, needs && "text-[#fbbf24]")}>
                  {s.vans
                    ? `${s.vans} vehicle${s.vans === 1 ? "" : "s"} · ${s.hotels} hotel${s.hotels === 1 ? "" : "s"}`
                    : needs
                      ? `${g} ${g === 1 ? "guest" : "guests"} · Needs a vehicle`
                      : "No vehicles yet"}
                </span>
              </span>
              {needs ? (
                <button
                  type="button"
                  data-issue-fix
                  onClick={() => onGoSection(s.key)}
                  className="flex-none cursor-pointer rounded-md border-0 bg-transparent px-1 py-0.5 text-[12px] font-semibold whitespace-nowrap text-[#93c5fd] hover:bg-white/[.07] hover:text-white"
                >
                  Fix ›
                </button>
              ) : null}
            </li>
          );
        })}
        {quiet.length ? (
          <li data-quiet className="border-t border-white/10 pt-2.5">
            <button
              type="button"
              aria-expanded={quietOpen}
              onClick={() => setQuietOpen((o) => !o)}
              className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[11.5px] text-[#94a3b8] hover:text-white"
            >
              <span
                aria-hidden
                className={cn("text-[10px]", quietOpen && "rotate-90")}
              >
                ▸
              </span>
              No guests today — nothing to do ({quiet.length}{" "}
              {quiet.length === 1 ? "tour" : "tours"})
            </button>
            {quietOpen ? (
              <span className={NAMES.replace("#fde68a", "#64748b")}>
                {quiet.map((s) => s.name).join(" · ")}
              </span>
            ) : null}
          </li>
        ) : null}
      </ul>
      <div className="flex items-start gap-2.5">
        <Mark kind="info" />
        <p className="m-0 text-[11.5px] leading-[1.5] text-[#64748b]">
          Saving does not text guests or drivers. Changes are saved when you
          press Save; tour manifests and the Send tab use the saved schedule.
        </p>
      </div>
    </aside>
  );
}

const GRP =
  "m-0 mb-3.5 flex list-none flex-col gap-[11px] border-b border-white/10 p-0 pb-3.5";
const T = "block text-[12.5px] leading-[1.35] font-semibold text-[#e2e8f0]";
const D = "mt-0.5 block text-[11.5px] leading-[1.45] text-[#64748b]";
const NAMES = "mt-[7px] block text-[11.5px] leading-[1.55] text-[#fde68a]";

function Mark({ kind }: { kind: "good" | "warn" | "idle" | "info" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-px flex size-[17px] flex-none items-center justify-center rounded-full font-bold",
        kind === "idle" ? "text-[13px]" : "text-[10px]",
        kind === "good"
          ? "bg-[rgba(74,222,128,.16)] text-[#4ade80]"
          : kind === "warn"
            ? "bg-[rgba(251,191,36,.16)] text-[#fbbf24]"
            : kind === "info"
              ? "bg-[rgba(59,130,246,.16)] text-[#93c5fd]"
              : "bg-white/[.07] text-[#64748b]",
      )}
    >
      {kind === "good"
        ? "✓"
        : kind === "warn"
          ? "!"
          : kind === "info"
            ? "i"
            : "·"}
    </span>
  );
}
