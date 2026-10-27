import type { Metadata } from "next";

import { ConfirmView } from "@/components/schedule/confirm-view";
import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";

export const metadata: Metadata = {
  title: "Confirm your schedule",
};

export default function ConfirmSchedulePage() {
  return (
    // 可见性开关（Annie 2026-10-25，key schedule_confirm_page）：对我不可见时整页不画。
    <PageVisibilityGate pageKey="schedule_confirm_page">
      <ConfirmView />
    </PageVisibilityGate>
  );
}
