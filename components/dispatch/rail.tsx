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
  return (
    <aside
      id="schedule-check"
      aria-label="Schedule check"
      className="flex flex-col gap-3 self-start rounded-lg border border-stone-200 bg-white p-4 xl:sticky xl:top-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-stone-900">Schedule check</h2>
        <p className="text-xs text-stone-500">
          Nothing here stops you from saving.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {analysis.sections.map((s) => (
          <li key={s.key} className="flex gap-2 text-sm">
            <Mark kind={s.vans ? "good" : "idle"} />
            <span>
              <span className="font-medium">{s.name}</span>{" "}
              <span className="text-stone-500">{s.when}</span>
              <span className="block text-xs text-stone-500">
                {s.vans
                  ? `${s.vans} vehicle${s.vans === 1 ? "" : "s"} · ${s.hotels} hotel${s.hotels === 1 ? "" : "s"}`
                  : "No vehicles yet"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {analysis.issues.length ? (
        <ul
          aria-label="Issues"
          className="flex flex-col gap-2 border-t border-stone-100 pt-3"
        >
          {analysis.issues.map((it, i) => {
            const names = it.names ?? [];
            const collapsed =
              names.length > NAMES_INLINE_MAX && !open[it.namesKey ?? ""];
            const body = (
              <span className="min-w-0">
                <span className="block text-sm font-medium text-stone-900">
                  {it.title}
                </span>
                {it.detail ? (
                  <span className="block text-xs text-stone-600">
                    {it.detail}
                  </span>
                ) : null}
                {names.length ? (
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
                        className="mt-1 text-xs font-medium text-sky-700 hover:underline"
                      >
                        {collapsed ? `View ${names.length} hotels ›` : "Hide ‹"}
                      </button>
                      {!collapsed ? (
                        <span className="block text-xs text-amber-900">
                          {names.join(" · ")}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="block text-xs text-amber-900">
                      {names.join(" · ")}
                    </span>
                  )
                ) : null}
              </span>
            );
            return (
              <li key={i} className="flex gap-2">
                <Mark kind="warn" />
                {typeof it.idx === "number" ? (
                  <button
                    type="button"
                    onClick={() => onGoto(it.idx!)}
                    className="text-left hover:underline"
                  >
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="border-t border-stone-100 pt-3 text-xs text-stone-500">
        Save schedule does not text guests or drivers. Tour manifests and the
        Send tab use the saved schedule, so save before you use them.
      </p>
    </aside>
  );
}

function Mark({ kind }: { kind: "good" | "warn" | "idle" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        kind === "good"
          ? "bg-emerald-100 text-emerald-700"
          : kind === "warn"
            ? "bg-amber-100 text-amber-800"
            : "bg-stone-100 text-stone-400",
      )}
    >
      {kind === "good" ? "✓" : kind === "warn" ? "!" : "·"}
    </span>
  );
}
