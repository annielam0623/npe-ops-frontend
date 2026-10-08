"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import type { Analysis } from "./config";

/** 多于这个数的酒店名单收起来，点 View 才展开。 */
const NAMES_INLINE_MAX = 4;

/** 右栏 Schedule check：一件事都不拦（只有「没司机」真的拦保存，那条在这里也列出来）。 */
export function Rail({
  analysis,
  onGoto,
}: {
  analysis: Analysis;
  onGoto: (idx: number) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // 样子照旧页面 `.rail`：深底上的半透明框；顶栏是 sticky 的 64px，所以贴在它下面 16px。
  return (
    <aside
      id="schedule-check"
      aria-label="Schedule check"
      className="sticky top-20 scroll-mt-20 self-start rounded-[14px] border border-white/10 bg-white/[.04] p-4"
    >
      <h2 className="m-0 mb-[3px] text-[13px] font-[650] tracking-[-.01em] text-white">
        Schedule check
      </h2>
      <p className="m-0 mb-3.5 text-[11.5px] text-[#64748b]">
        Nothing here stops you from saving.
      </p>
      <ul className={GRP}>
        {analysis.sections.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5">
            <Mark kind={s.vans ? "good" : "idle"} />
            <span className="min-w-0">
              <span className={T}>
                {s.name} {s.when}
              </span>
              <span className={D}>
                {s.vans
                  ? `${s.vans} vehicle${s.vans === 1 ? "" : "s"} · ${s.hotels} hotel${s.hotels === 1 ? "" : "s"}`
                  : "No vehicles yet"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {analysis.issues.length ? (
        <ul aria-label="Issues" className={GRP}>
          {analysis.issues.map((it, i) => {
            const names = it.names ?? [];
            const collapsed =
              names.length > NAMES_INLINE_MAX && !open[it.namesKey ?? ""];
            const body = (
              <span className="min-w-0">
                <span className={T}>{it.title}</span>
                {it.detail ? <span className={D}>{it.detail}</span> : null}
              </span>
            );
            const list = names.length ? (
              names.length > NAMES_INLINE_MAX ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((o) => ({
                        ...o,
                        [it.namesKey ?? ""]: !o[it.namesKey ?? ""],
                      }))
                    }
                    className="mt-[9px] inline-flex items-center gap-1.5 rounded-lg border border-white/16 bg-white/[.04] px-[11px] py-[5px] text-[11.5px] font-semibold text-[#cbd5e1] hover:bg-white/[.09] hover:text-white"
                  >
                    {collapsed ? (
                      <>
                        View {names.length} hotels
                        <span className="text-[12px] text-[#94a3b8]">›</span>
                      </>
                    ) : (
                      "Hide ‹"
                    )}
                  </button>
                  {!collapsed ? (
                    <span className={NAMES}>{names.join(" · ")}</span>
                  ) : null}
                </>
              ) : (
                <span className={NAMES}>{names.join(" · ")}</span>
              )
            ) : null;
            return (
              <li key={i} className="flex items-start gap-2.5">
                <Mark kind="warn" />
                <span className="min-w-0">
                  {typeof it.idx === "number" ? (
                    // 指得到某一行的那几条，点一下滚到那一行（旧 `.ri.go`）。
                    <button
                      type="button"
                      onClick={() => onGoto(it.idx!)}
                      className="-mx-1.5 -my-1 block rounded-lg px-1.5 py-1 text-left hover:bg-white/[.05]"
                    >
                      {body}
                    </button>
                  ) : (
                    body
                  )}
                  {list}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex items-start gap-2.5">
        <Mark kind="info" />
        <p className="m-0 text-[11.5px] leading-[1.5] text-[#64748b]">
          Save schedule does not text guests or drivers. Tour manifests and the
          Send tab use the saved schedule, so save before you use them.
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
