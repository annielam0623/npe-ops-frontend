import type { Metadata } from "next";

import { BugReportsView } from "@/components/bug-reports/bug-reports-view";

export const metadata: Metadata = {
  title: "Bug Reports",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function BugReportsPage() {
  return <BugReportsView />;
}
