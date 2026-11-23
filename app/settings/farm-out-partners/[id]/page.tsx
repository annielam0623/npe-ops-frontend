import type { Metadata } from "next";

import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";
import { PartnerPage } from "@/components/farm-out/partner-page";

export const metadata: Metadata = {
  title: "Farm out Partner",
};

// 每家合作公司自己的页（第 8 件，Annie 11-20「8-Q7–Q11 都 A | 动手」；Q5「我需要每个partner一页」）。
// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default async function FarmOutPartnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    // 可见性开关（Annie 2026-10-25，key farm_out_settings）：对我不可见时整页不画。
    // key：下拉换公司时整页重来（编辑状态、折叠行都回到刚打开的样子）。
    <PageVisibilityGate pageKey="farm_out_settings">
      <PartnerPage key={id} partnerId={Number(id)} />
    </PageVisibilityGate>
  );
}
