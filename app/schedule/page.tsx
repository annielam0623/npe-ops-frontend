import type { Metadata } from "next";

import { ComingSoon } from "@/components/nav/coming-soon";

export const metadata: Metadata = {
  title: "Staff Schedule",
};

// 还没有页面（dashboard 改版，Annie 2026-10-11）：先放占位页，侧栏和快捷方式照样能进来。
export default function StaffSchedulePage() {
  return <ComingSoon id="schedule" />;
}
