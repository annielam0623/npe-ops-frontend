import type { Metadata } from "next";

import { WorkSheet } from "@/components/dispatch-sheets/work-sheet";

export const metadata: Metadata = {
  title: "Work Sheet",
};

// 只在浏览器里用（草稿存本机），不读写库。
export default function WorkSheetPage() {
  return <WorkSheet />;
}
