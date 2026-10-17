import type { Metadata } from "next";

import { PartnersView } from "@/components/farm-out/partners-view";

export const metadata: Metadata = {
  title: "Farm out Partners",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function FarmOutPartnersPage() {
  return <PartnersView />;
}
