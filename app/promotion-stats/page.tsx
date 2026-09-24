import type { Metadata } from "next";

import { PromotionStatsView } from "@/components/promotion-stats/promotion-stats-view";

export const metadata: Metadata = {
  title: "Promotion Stats",
};

// 数据只在客户端组件里请求：session cookie 在后端域名下，只有浏览器发起的请求才会带上。
export default function PromotionStatsPage() {
  return <PromotionStatsView />;
}
