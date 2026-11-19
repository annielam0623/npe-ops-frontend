import type { Metadata } from "next";

import { MyScheduleView } from "@/components/schedule/my-schedule-view";
import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";

export const metadata: Metadata = {
  title: "My schedule",
};

export default function MySchedulePage() {
  return (
    // 可见性照旧用 Confirm your schedule 的开关（Annie 2026-11-19 6A，key schedule_confirm_page）。
    <PageVisibilityGate pageKey="schedule_confirm_page">
      <MyScheduleView />
    </PageVisibilityGate>
  );
}
