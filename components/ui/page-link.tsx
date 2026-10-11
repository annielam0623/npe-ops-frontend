import Link from "next/link";
import type { ComponentProps } from "react";

import { isSwitched, pageHref } from "@/lib/page-switch";

/**
 * 站内链到另一页（ops 路径，可带查询串）。分批切换（lib/page-switch.ts）：那一页已切换 ⇒ 站内 Link；
 * 还没切换 ⇒ 普通链接到旧后台的路径（同一个网址下，查询串照带），staff 不会从已切换的页面点进还没切换的新页面。
 */
export function PageLink({
  href,
  ...rest
}: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  const [path, query] = href.split("?", 2);
  if (isSwitched(path)) return <Link href={href} {...rest} />;
  const target = pageHref(path);
  return (
    <a
      href={
        query ? `${target}${target.includes("?") ? "&" : "?"}${query}` : target
      }
      {...rest}
    />
  );
}
