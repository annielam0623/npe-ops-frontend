"use client";

import { PageLink } from "@/components/ui/page-link";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import type { OrderDetail } from "@/types";

/**
 * 蓝色实心键（132 Q4 选 D，Annie「你键设成白色谁知道它能按呢」「你不会用个蓝色么」「D动手」）：跟 Save 同一个蓝，
 * 白色粗字、带 →，鼠标移上去稍深。只是跳页、不存东西——「蓝色按钮只用于提交」的一个例外（同右下角 ↑↓）。
 */
const KEY =
  "inline-flex h-[30px] items-center rounded-[8px] border border-[#3b82f6] bg-[#3b82f6] px-3 text-[12.5px] font-bold whitespace-nowrap text-white no-underline hover:border-[#2563eb] hover:bg-[#2563eb]";

/** 字的颜色：dark = 搜索栏订单卡片 / Morning 对话框（深色底），light = Tour / Tickets 对话框（白底）。 */
const TONE = {
  dark: {
    label: "text-white/55",
    hold: "text-[#fbbf24]",
    none: "text-white/60",
  },
  light: {
    label: "text-[#6b7280]",
    hold: "text-[#8a5a00]",
    none: "text-[#57534e]",
  },
} as const;

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
  tone = "dark",
  newTab = false,
}: {
  order: OrderDetail;
  className?: string;
  tone?: "dark" | "light";
  /** 对话框里（132 Q3 选 B）：开新标签，Tracking 页和对话框留在原来的标签。搜索栏照旧本页跳。 */
  newTab?: boolean;
}) {
  const partner = usePermissions().partnerView;
  const links = order.manifest_links;
  if (partner || !Array.isArray(links)) return null;
  const hold = isOnHold(order.status);
  const orderList = `/orders?q=${encodeURIComponent(order.order_number)}`;
  const many = links.length > 1;
  const c = TONE[tone];
  const tab = newTab ? { target: "_blank", rel: "noopener" } : {};
  return (
    <div
      data-manifest-links
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <span className={cn("mr-0.5 text-[12px]", c.label)}>Main manifest:</span>
      {links.length ? (
        <>
          {links.map((l) => (
            <PageLink
              key={`${l.date}|${l.tab}|${l.pill ?? ""}`}
              href={manifestHref(l, hold)}
              data-open-in-manifest={`${l.tab}|${l.pill ?? ""}`}
              className={KEY}
              {...tab}
            >
              {many
                ? `${l.tab_label || l.tab}${l.pill_label ? ` · ${l.pill_label}` : ""} →`
                : "Open in Main manifest →"}
            </PageLink>
          ))}
          {hold ? (
            <span data-manifest-hold className={cn("text-[12.5px]", c.hold)}>
              On Hold — it will not be pre-ticked. Check Order List before
              sending.
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span data-manifest-none className={cn("text-[12.5px]", c.none)}>
            {isCancelled(order.status)
              ? "Cancelled orders are not on Main manifest. Check Order List."
              : "This order is not on Main manifest for its tour date. Check its status in Order List."}
          </span>
          <PageLink href={orderList} className={KEY} {...tab}>
            Open Order List →
          </PageLink>
        </>
      )}
    </div>
  );
}
