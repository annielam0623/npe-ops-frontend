import type { Metadata } from "next";

import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";
import { ScheduleView } from "@/components/schedule/schedule-view";

export const metadata: Metadata = {
  title: "Staff Schedule",
};

export default function StaffSchedulePage() {
  return (
    // 可见性开关（Annie 2026-10-25，key schedule_page）：对我不可见时整页不画。
    <PageVisibilityGate pageKey="schedule_page">
      <ScheduleView />
    </PageVisibilityGate>
  );
}
