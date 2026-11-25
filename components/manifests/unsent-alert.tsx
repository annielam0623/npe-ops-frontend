"use client";

import type { UnsentOrders } from "@/lib/manifests-api";
import { cn } from "@/lib/utils";

/**
 * G380 未发新单提醒（Annie 2026-11-23 答 8 题；preview https://claude.ai/artifact/8YtCoE8VWFXjV6iCt3pZTk）。
 * B+C（Annie 2026-11-24「只需要显示未来几天，每天有几单…只显示总数，点进去就可以进到那一天的页面…点击红色胶囊就可以看到」「动手」；
 * preview https://claude.ai/artifact/QPjDQxqRiDcsZg331EbbZr 第 2–7 节）：
 * 不管几单都写「⚠ New orders not sent [总数] Wed Nov 25 (2) · Thu Nov 26 (1) …」，只列有新单的日子，不再逐单列单号。
 * 正在看的那一天加粗、没下划线、不能点；别的日子点了去那天（onPickDay）。数字、日期只算当前标签（unsentForTab）。
 * 红框照页面已有的淡红条，数字照 Dashboard 的红气泡。
 */
export function UnsentAlert({
  data,
  currentDate,
  onPickDay,
  className,
}: {
  data: UnsentOrders | null;
  /** 正在看的日期（YYYY-MM-DD）。 */
  currentDate: string;
  onPickDay: (date: string) => void;
  className?: string;
}) {
  if (!data || data.count <= 0) return null;
  const days = unsentDays(data);
  return (
    <div
      role="status"
      data-unsent-alert="days"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border-[0.5px] border-[#e4a5a0] bg-[#fdeceb] px-2.5 py-1 text-[12.5px] leading-snug text-[#7a2424] night:border-rose-400/30 night:bg-rose-400/10 night:text-rose-200",
        // 手机：一行放不下就横着滑（preview 第 4 节），日期一个都不截掉。
        "max-sm:flex-nowrap max-sm:overflow-x-auto",
        className,
      )}
    >
      <span className="shrink-0 font-bold whitespace-nowrap">
        ⚠ New orders not sent
      </span>
      <span
        data-unsent-count
        className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#dc3545] px-1.5 text-[10px] leading-none font-bold whitespace-nowrap text-white tabular-nums"
      >
        {data.count}
      </span>
      {days.map((d, i) => {
        const here = d.date === currentDate;
        const label = `${dayLabel(d.date)} (${d.count})`;
        return (
          <span
            key={d.date}
            className="inline-flex shrink-0 items-center gap-2"
          >
            {i > 0 ? (
              <span aria-hidden className="opacity-55">
                ·
              </span>
            ) : null}
            {here ? (
              <span
                data-unsent-day={d.date}
                data-here=""
                title="You are on this day"
                className="font-extrabold whitespace-nowrap"
              >
                {label}
              </span>
            ) : (
              <button
                type="button"
                data-unsent-day={d.date}
                onClick={() => onPickDay(d.date)}
                className="cursor-pointer font-semibold whitespace-nowrap underline underline-offset-2 hover:text-[#4a1010] night:hover:text-white"
              >
                {label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** 每天几张（同一「单号 + 团期」只算一张），只留有新单的日子；顺序照接口的 dates[]（没在里面的排后面）。 */
export function unsentDays(
  data: UnsentOrders,
): { date: string; count: number }[] {
  const per = new Map<string, Set<string>>();
  for (const o of data.orders) {
    let s = per.get(o.tour_date);
    if (!s) per.set(o.tour_date, (s = new Set()));
    s.add(o.order_number);
  }
  const order = [
    ...data.dates,
    ...[...per.keys()].filter((d) => !data.dates.includes(d)).sort(),
  ];
  return order
    .filter((d) => per.get(d)?.size)
    .map((d) => ({ date: d, count: per.get(d)!.size }));
}

/**
 * G380 分标签（Annie 2026-11-24「tour和ticket的unsent提醒的数字…是要分开的」「动手，Admin fee选A」）：
 * 只留这个标签的单（Bus 只算 bus、Tickets 只算 tickets，Admin fee 等没有的标签 = null 不出红框）；
 * 张数照后端 summarize 的算法重算：同一「单号 + 团期」只算一张。
 */
export function unsentForTab(
  data: UnsentOrders | null,
  tab: string,
): UnsentOrders | null {
  if (!data) return null;
  const orders = data.orders.filter((o) => o.tab === tab);
  const count = new Set(orders.map((o) => `${o.order_number}|${o.tour_date}`))
    .size;
  if (!count) return null;
  return {
    ...data,
    count,
    orders,
    pills: data.pills.filter((p) => p.tab === tab),
  };
}

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** 「Wed Nov 25」。 */
function dayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m
    ? DAY.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))).replace(",", "")
    : ymd;
}
