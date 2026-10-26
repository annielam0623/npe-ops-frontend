import type { Metadata } from "next";

import { ComingSoon } from "@/components/nav/coming-soon";
import { PageVisibilityGate } from "@/components/ui/page-visibility-gate";

export const metadata: Metadata = {
  title: "Quotation",
};

// 还没有页面（dashboard 改版，Annie 2026-10-11）：先放占位页，侧栏和快捷方式照样能进来。
// 仅 Super Admin 可见（Annie 2026-10-26，key quotation）：对我不可见时整页不画。
export default function QuotationPage() {
  return (
    <PageVisibilityGate pageKey="quotation">
      <ComingSoon id="quotation" />
    </PageVisibilityGate>
  );
}
