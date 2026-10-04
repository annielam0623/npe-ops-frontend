import type { Metadata } from "next";

import { ContentStudioView } from "@/components/content-studio/content-studio-view";

export const metadata: Metadata = {
  title: "Content Studio",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function ContentStudioPage() {
  return <ContentStudioView />;
}
