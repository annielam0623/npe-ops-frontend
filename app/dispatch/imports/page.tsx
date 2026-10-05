import type { Metadata } from "next";

import { DispatchImportsView } from "@/components/dispatch-imports/imports-view";

export const metadata: Metadata = {
  title: "Dispatch Imports",
};

// 默认从洛杉矶今天往前 7 天看起（服务端定）；认 ?since=。
export default function DispatchImportsPage() {
  return <DispatchImportsView />;
}
