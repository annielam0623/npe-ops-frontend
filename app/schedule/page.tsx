import type { Metadata } from "next";

import { ScheduleView } from "@/components/schedule/schedule-view";

export const metadata: Metadata = {
  title: "Staff Schedule",
};

export default function StaffSchedulePage() {
  return <ScheduleView />;
}
