"use client";

import { BreakdownView } from "./breakdown-view";

/**
 * Sales Report（Annie 2026-10-23）：按 Manifest Group 分段的 Orders / Pax / $ Amount / All three。
 * 旧的 Bus Tour / Tickets 按 agent 月表周表 Annie 2026-10-23 晚说「旧的报表不留」，已删（后端旧接口不动）。
 */
export function SalesReportView() {
  return (
    <main className="text-stone-800 night:text-white/90">
      <BreakdownView />
    </main>
  );
}
