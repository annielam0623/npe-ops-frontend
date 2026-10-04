import type { Metadata } from "next";

import { OpsSummaryView } from "@/components/ops-summary/ops-summary-view";

export const metadata: Metadata = {
  title: "Operations Summary",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function OpsSummaryPage() {
  return <OpsSummaryView />;
}
