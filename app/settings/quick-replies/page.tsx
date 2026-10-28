import type { Metadata } from "next";

import { QuickRepliesView } from "@/components/quick-replies/quick-replies-view";

export const metadata: Metadata = {
  title: "Driver Quick Replies",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function QuickRepliesPage() {
  return <QuickRepliesView />;
}
