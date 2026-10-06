import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/nav/app-frame";
import { InAppHistory } from "@/components/nav/in-app-history";
import { PickerOnClick } from "@/components/ui/picker-on-click";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NPE 运营系统",
    template: "%s · NPE 运营系统",
  },
  description: "NPE 员工后台运营系统（Operation System）",
  // 员工后台不应被搜索引擎收录，这里全局设置，覆盖所有页面。
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <PickerOnClick />
        <InAppHistory />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
