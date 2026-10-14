import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/nav/app-frame";
import { InAppHistory } from "@/components/nav/in-app-history";
import { PickerOnClick } from "@/components/ui/picker-on-click";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

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
    // data-theme 由下面的脚本在浏览器里设（全深色预览），和服务端渲染的不一样是预期的。
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <PickerOnClick />
        <InAppHistory />
        <AppFrame>{children}</AppFrame>
        {/* 窗口底部的横向滚动条，全站共用（照抄旧后台 base.html 挂的 window-hscroll.js，Annie 2026-10-14）。 */}
        <Script src="/window-hscroll.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
