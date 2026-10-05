import type { Metadata } from "next";

import { TourTrackingView } from "@/components/tour-tracking/tour-tracking-view";

export const metadata: Metadata = {
  title: "Tour Confirmation — Tracking",
};

// 默认洛杉矶今天；认 ?date=（dashboard 的消息卡片带过来）。
export default function TourTrackingPage() {
  return <TourTrackingView />;
}
