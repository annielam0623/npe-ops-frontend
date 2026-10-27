import type { Metadata } from "next";

import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";
import { TimetableView } from "@/components/farm-out/timetable-view";

export const metadata: Metadata = {
  title: "Farm out Timetable",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function FarmOutTimetablePage() {
  return (
    // 可见性开关（Annie 2026-10-25，key farm_out_settings）：对我不可见时整页不画。
    <PageVisibilityGate pageKey="farm_out_settings">
      <TimetableView />
    </PageVisibilityGate>
  );
}
