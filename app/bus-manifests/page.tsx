import type { Metadata } from "next";

import { BusManifestsView } from "@/components/dispatch-manifest/bus-manifests-view";

export const metadata: Metadata = {
  title: "Bus Manifests",
};

// 日期从 ?date= 读（在浏览器里），没有就今天（洛杉矶）。
export default function BusManifestsPage() {
  return <BusManifestsView />;
}
