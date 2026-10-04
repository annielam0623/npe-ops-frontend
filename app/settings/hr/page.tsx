import type { Metadata } from "next";

import { HRView } from "@/components/hr/hr-view";

export const metadata: Metadata = {
  title: "Human Resource",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function HRPage() {
  return <HRView />;
}
