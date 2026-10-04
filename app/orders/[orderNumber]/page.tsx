import type { Metadata } from "next";

import { OrderDetailView } from "@/components/orders/order-detail-view";

export const metadata: Metadata = {
  title: "Order Detail",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  return <OrderDetailView orderNumber={decodeURIComponent(orderNumber)} />;
}
