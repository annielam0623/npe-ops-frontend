import type { Metadata } from "next";

import { TicketsTrackingView } from "@/components/tickets-tracking/tickets-tracking-view";

export const metadata: Metadata = {
  title: "Tickets Reminder Tracking",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function TicketsTrackingPage() {
  return <TicketsTrackingView />;
}
