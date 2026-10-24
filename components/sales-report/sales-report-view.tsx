"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { BreakdownView } from "./breakdown-view";
import { LegacySalesView } from "./legacy-sales-view";

type View = "products" | "agents";

const VIEWS: readonly { value: View; label: string }[] = [
  { value: "products", label: "By group & product" },
  { value: "agents", label: "Legacy: by agent" },
];

/**
 * Sales Report（Annie 2026-10-23）：默认是新的「按 Manifest Group 分段，Orders / Pax / $ Amount」；
 * 旧的 Bus Tour / Tickets 月表周表（按 agent）先留成一个 Legacy 标签，是否保留做对账等 Annie 定。
 */
export function SalesReportView() {
  const [view, setView] = useState<View>("products");
  return (
    <main className="text-stone-800 night:text-white/90">
      <div
        role="tablist"
        aria-label="Sales report view"
        className="mb-5 flex border-b-[1.5px] border-white/10"
      >
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => setView(v.value)}
            className={cn(
              "-mb-[1.5px] cursor-pointer border-b-2 px-5 py-2 text-[14px] font-medium",
              view === v.value
                ? "border-[#f8fafc] text-[#f8fafc]"
                : "border-transparent text-[#888] night:text-white/55",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "products" ? <BreakdownView /> : <LegacySalesView />}
    </main>
  );
}
