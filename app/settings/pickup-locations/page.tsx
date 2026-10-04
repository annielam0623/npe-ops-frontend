import type { Metadata } from "next";

import { PickupLocationsView } from "@/components/pickup-locations/pickup-locations-view";

export const metadata: Metadata = {
  title: "Pickup Locations",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function PickupLocationsPage() {
  return <PickupLocationsView />;
}
