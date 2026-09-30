import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = {
  title: "Dashboard",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源 /api/* 请求才会带上。
export default function DashboardPage() {
  return <DashboardView />;
}
