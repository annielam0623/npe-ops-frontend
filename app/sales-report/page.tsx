import type { Metadata } from "next";

import { SalesReportView } from "@/components/sales-report/sales-report-view";
import { PageGate } from "@/components/ui/page-gate";

export const metadata: Metadata = {
  title: "Sales Report",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function SalesReportPage() {
  return (
    // 仅 Super Admin 可见（Annie 2026-10-26，key sales_report）：对我不可见时整页不画。
    <PageGate pageKey="sales_report">
      <SalesReportView />
    </PageGate>
  );
}
