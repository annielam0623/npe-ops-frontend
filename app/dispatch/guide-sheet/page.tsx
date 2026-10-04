import type { Metadata } from "next";

import { GuideSheet } from "@/components/dispatch-sheets/guide-sheet";

export const metadata: Metadata = {
  title: "Guide Sheet",
};

// 只在浏览器里用（草稿存本机），不读写库。
export default function GuideSheetPage() {
  return <GuideSheet />;
}
