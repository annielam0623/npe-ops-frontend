import type { Metadata } from "next";

import { RelayListView } from "@/components/relay-list/relay-list-view";

export const metadata: Metadata = {
  title: "Relay list",
};

// Dispatch › Morning Relay「📋 Relay list」：已保存的排车排成纸本那几张单（屏幕上看、按 Print 打印）。
export default function RelayListPage() {
  return <RelayListView />;
}
