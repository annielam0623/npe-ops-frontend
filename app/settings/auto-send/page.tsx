import type { Metadata } from "next";

import { AutoSendView } from "@/components/auto-send/auto-send-view";

export const metadata: Metadata = {
  title: "Auto Send",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function AutoSendPage() {
  return <AutoSendView />;
}
