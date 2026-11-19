import type { Metadata } from "next";

import { TestSendView } from "@/components/test-send/test-send-view";

export const metadata: Metadata = {
  title: "Test send",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function TestSendPage() {
  return <TestSendView />;
}
