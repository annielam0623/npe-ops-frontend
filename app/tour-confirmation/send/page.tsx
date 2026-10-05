import type { Metadata } from "next";

import { TourSendView } from "@/components/tour-send/tour-send-view";

export const metadata: Metadata = {
  title: "Tour Confirmation — Send",
};

export default function TourSendPage() {
  return <TourSendView />;
}
