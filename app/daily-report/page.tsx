import type { Metadata } from "next";

import { ReportsView } from "@/components/daily-report/reports-view";

export const metadata: Metadata = {
  title: "Daily Operation Report",
};

export default function DailyReportPage() {
  return <ReportsView />;
}
