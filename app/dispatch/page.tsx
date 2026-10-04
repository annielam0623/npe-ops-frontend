import type { Metadata } from "next";

import { DispatchView } from "@/components/dispatch/dispatch-view";

export const metadata: Metadata = {
  title: "Dispatch",
};

// 默认打开明天（洛杉矶，服务端定）；认 ?date=。
export default function DispatchPage() {
  return <DispatchView />;
}
