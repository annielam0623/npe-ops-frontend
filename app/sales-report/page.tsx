import type { Metadata } from "next";

import { SalesReportView } from "@/components/sales-report/sales-report-view";

export const metadata: Metadata = {
  title: "Sales Report",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function SalesReportPage() {
  return <SalesReportView />;
}
