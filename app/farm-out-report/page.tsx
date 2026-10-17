import type { Metadata } from "next";

import { FarmOutReportView } from "@/components/farm-out-report/farm-out-report-view";

export const metadata: Metadata = {
  title: "Farm out Report",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function FarmOutReportPage() {
  return <FarmOutReportView />;
}
