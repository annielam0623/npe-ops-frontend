import type { Metadata } from "next";

import { MorningTrackingView } from "@/components/morning-tracking/morning-tracking-view";

export const metadata: Metadata = {
  title: "Morning Pickup Tracking",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function MorningTrackingPage() {
  return <MorningTrackingView />;
}
