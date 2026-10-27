import type { Metadata } from "next";

import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";
import { TimetableView } from "@/components/farm-out/timetable-view";

export const metadata: Metadata = {
  title: "Farm out Timetable",
};

// 每家 Partner 自己的时刻表（G199，Annie 2026-10-27「每个 partner 都有自己的专属 timetable」），从 Partners 页的 Timetable 键进。
// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default async function PartnerTimetablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    // 可见性开关（Annie 2026-10-25，key farm_out_settings）：对我不可见时整页不画。
    <PageVisibilityGate pageKey="farm_out_settings">
      <TimetableView partnerId={Number(id)} />
    </PageVisibilityGate>
  );
}