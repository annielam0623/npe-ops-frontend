import type { Metadata } from "next";

import { ManifestsView } from "@/components/manifests/manifests-view";

export const metadata: Metadata = {
  title: "Manifests",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function ManifestsPage() {
  return <ManifestsView />;
}
