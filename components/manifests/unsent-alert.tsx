"use client";

import type { UnsentOrder, UnsentOrders } from "@/lib/manifests-api";
import { cn } from "@/lib/utils";

/**
 * G380 未发新单提醒（Annie 2026-11-23 答 8 题、11-24「第一件做」；preview https://claude.ai/artifact/8YtCoE8VWFXjV6iCt3pZTk）：
 * 0 单什么都不出；1–3 单逐单「单号 · 团期 · 团」，点了跳到那一行并勾上（Q4 A）；
 * 超过 3 单只出红数字（Q5：不做 Show 下拉，靠变红的胶囊点进去）。红框照页面已有的淡红条，数字照 Dashboard 的红气泡。
 */
export function UnsentAlert({
  data,
  onPick,
  className,
}: {
  data: UnsentOrders | null;
  onPick: (order: UnsentOrder) => void;
  className?: string;
}) {
  if (!data || data.count <= 0) return null;
  const many = data.count > 3 || data.orders.length > 3;
  return (
    <div
      role="status"
      data-unsent-alert={many ? "count" : "list"}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border-[0.5px] border-[#e4a5a0] bg-[#fdeceb] px-2.5 py-1 text-[12.5px] leading-snug text-[#7a2424] night:border-rose-400/30 night:bg-rose-400/10 night:text-rose-200",
        "max-sm:flex-nowrap",
        className,
      )}
    >
      <span className="shrink-0 font-bold whitespace-nowrap">
        ⚠ New orders not sent{many ? "" : ":"}
      </span>
      {many ? (
        <>
          <span
            data-unsent-count
            className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#dc3545] px-1.5 text-[10px] leading-none font-bold whitespace-nowrap text-white tabular-nums"
          >
            {data.count}
          </span>
          <span className="min-w-0 max-sm:truncate">
            Open the red pills to find them.
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-wrap gap-x-2.5 gap-y-0.5 max-sm:flex-nowrap max-sm:overflow-x-auto">
          {data.orders.map((o) => (
            <button
              key={`${o.order_number}|${o.tour_date}|${o.tab}|${o.pill}`}
              type="button"
              data-unsent-order={o.order_number}
              title={`${o.product} · ${o.pax} pax`}
              onClick={() => onPick(o)}
              className="shrink-0 cursor-pointer font-semibold whitespace-nowrap underline underline-offset-2 hover:text-[#4a1010] night:hover:text-white"
            >
              {unsentLabel(o)}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** 「CHD123456 · Tue Nov 25 · South Rim」（Q4 A，同后端 Notice 标题的写法）。 */
export function unsentLabel(o: UnsentOrder): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.tour_date);
  const day = m
    ? DAY.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))).replace(",", "")
    : o.tour_date;
  return [o.order_number, day, o.pill_label].filter(Boolean).join(" · ");
}
