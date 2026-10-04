import type { Metadata } from "next";

import { BroadcastingLogView } from "@/components/broadcasting-log/broadcasting-log-view";

export const metadata: Metadata = {
  title: "Broadcasting Log",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function BroadcastingLogPage() {
  return <BroadcastingLogView />;
}
