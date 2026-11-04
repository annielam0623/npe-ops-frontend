"use client";

import { PageLink } from "@/components/ui/page-link";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import type { OrderDetail } from "@/types";

/** 白键（只是跳页，不是提交，不用蓝色）。 */
const WHITE_KEY =
  "inline-flex h-[30px] items-center rounded-[8px] border border-black/25 bg-white px-3 text-[12.5px] font-bold whitespace-nowrap text-[#111] no-underline hover:bg-[#f4f4f5]";

const isCancelled = (status: string) => /cancel/i.test(status);
const isOnHold = (status: string) => /hold/i.test(status);

/** Main manifest 上那一单的网址：?date / tab / pill + row（这单的行，逗号隔开）；On Hold 带 tick=0（只标黄不预勾）。 */
export function manifestHref(
  link: NonNullable<OrderDetail["manifest_links"]>[number],
  hold: boolean,
): string {
  const q = new URLSearchParams({ date: link.date, tab: link.tab });
  if (link.pill) q.set("pill", link.pill);
  q.set("row", link.row_keys.join(","));
  if (hold) q.set("tick", "0");
  return `/manifests?${q.toString()}`;
}

/**
 * 置顶 51 B（Annie「同意全部推荐。动手」；preview https://claude.ai/artifact/PhPav7b9m1sjrxmfa8sv8F ，5 题全 A）：
 * 订单卡片最下面一行「Main manifest:」——这单在 Main manifest 上 ⇒ 白键「Open in Main manifest →」（分在几处就每处一个
 * 「标签 · 胶囊 →」）；不在 / 已取消 ⇒ 灰字 + 「Open Order List →」（订单流固定：状态看 Order List，不另去 Rezdy）；
 * On Hold ⇒ 给键但跳过去不预勾，旁边黄字。后端没带 manifest_links（旧后端）⇒ 整行不出。partner 不出。
 */
export function ManifestLinks({
  order,
  className,
}: {
  order: OrderDetail;
  className?: string;
}) {
  const partner = usePermissions().partnerView;
  const links = order.manifest_links;
  if (partner || !Array.isArray(links)) return null;
  const hold = isOnHold(order.status);
  const orderList = `/orders?q=${encodeURIComponent(order.order_number)}`;
  const many = links.length > 1;
  return (
    <div
      data-manifest-links
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <span className="mr-0.5 text-[12px] text-white/55">Main manifest:</span>
      {links.length ? (
        <>
          {links.map((l) => (
            <PageLink
              key={`${l.date}|${l.tab}|${l.pill ?? ""}`}
              href={manifestHref(l, hold)}
              data-open-in-manifest={`${l.tab}|${l.pill ?? ""}`}
              className={WHITE_KEY}
            >
              {many
                ? `${l.tab_label || l.tab}${l.pill_label ? ` · ${l.pill_label}` : ""} →`
                : "Open in Main manifest →"}
            </PageLink>
          ))}
          {hold ? (
            <span data-manifest-hold className="text-[12.5px] text-[#fbbf24]">
              On Hold — it will not be pre-ticked. Check Order List before
              sending.
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span data-manifest-none className="text-[12.5px] text-white/60">
            {isCancelled(order.status)
              ? "Cancelled orders are not on Main manifest. Check Order List."
              : "This order is not on Main manifest for its tour date. Check its status in Order List."}
          </span>
          <PageLink href={orderList} className={WHITE_KEY}>
            Open Order List →
          </PageLink>
        </>
      )}
    </div>
  );
}
