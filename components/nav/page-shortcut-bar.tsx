"use client";

import { usePathname } from "next/navigation";

import { NavProvider } from "./nav-context";
import { ShortcutBar } from "./shortcut-bar";

/**
 * 不套站点外框的整页（三个 Tracking 页）最上面的 My shortcuts 条（Annie 2026-10-19：「My shortcuts 总是在页面顶端，
 * 所有页面，包括 tracking 页面」）。这些页没有 AppFrame，自己带一份 NavProvider；条钉在最上面，样子同其它页的 ShortcutBar（深色底）。
 * 页面原有的 ← Back 去掉，只留条里的那个。
 */
export function PageShortcutBar() {
  const pathname = usePathname() ?? "/";
  return (
    <NavProvider>
      <div className="sticky top-0 z-30 bg-[#06101c] print:hidden">
        <ShortcutBar pathname={pathname} />
      </div>
    </NavProvider>
  );
}
