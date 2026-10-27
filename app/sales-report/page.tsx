import type { Metadata } from "next";

import { SalesReportView } from "@/components/sales-report/sales-report-view";
import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";

export const metadata: Metadata = {
  title: "Sales Report",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function SalesReportPage() {
  return (
    // 可见性开关（Annie 2026-10-25，key sales_report）：对我不可见时整页不画。
    <PageVisibilityGate pageKey="sales_report">
      <SalesReportView />
    </PageVisibilityGate>
  );
}
