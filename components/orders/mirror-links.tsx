"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import type { OrderMirror } from "@/types";

/**
 * Mirror（Rezdy ↔ TripGuru 孪生单，Annie 在后端窗口「动手」；后端 95 做配对）：另一个渠道的单号，一个一行，
 * 每个都能点进那单的 Order details（/orders/<单号>，两个渠道同一个页面）。没有 = 「—」（同别的空格）。
 * 颜色照 Source 列：TripGuru 浅蓝底蓝字、Rezdy 浅灰底黑字。只是显示，不能改。
 * ⚠️ 字段形状是占位（等后端合同）：rows[].mirror = [{order_number, source}]；旧后端没有这个键 ⇒ 页面不出这一列。
 */
const TONE: Record<string, { light: string; dark: string }> = {
  tripguru: {
    light:
      "bg-[#E6F1FB] text-[#185FA5] night:bg-sky-400/[.08] night:text-sky-300",
    dark: "bg-sky-400/[.12] text-[#93c5fd]",
  },
  rezdy: {
    light:
      "bg-[#f1efe8] text-[#1a1a1a] night:bg-white/[.04] night:text-white/75",
    dark: "bg-white/[.08] text-white/85",
  },
};

const SOURCE_NAME: Record<string, string> = {
  tripguru: "TripGuru",
  rezdy: "Rezdy",
};

export function MirrorLinks({
  mirror,
  dark = false,
  className,
}: {
  mirror: readonly OrderMirror[] | undefined;
  /** 深色底（顶栏搜索的结果卡）。 */
  dark?: boolean;
  className?: string;
}) {
  if (!mirror || mirror.length === 0)
    return (
      <span
        data-mirror-empty
        className={dark ? "text-white/40" : "text-[#1a1a1a] night:text-white/35"}
      >
        —
      </span>
    );
  return (
    <span data-mirror className={cn("inline-flex flex-col gap-1", className)}>
      {mirror.map((m) => {
        const tone = TONE[m.source] ?? TONE.rezdy;
        return (
          <Link
            key={`${m.source}-${m.order_number}`}
            href={`/orders/${encodeURIComponent(m.order_number)}`}
            data-mirror-link={m.order_number}
            title={`${SOURCE_NAME[m.source] ?? m.source} order ${m.order_number} — open its order details`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-block w-fit rounded-[10px] px-[7px] py-0.5 text-[11px] font-medium whitespace-nowrap no-underline hover:underline",
              dark ? tone.dark : tone.light,
            )}
          >
            {m.order_number}
          </Link>
        );
      })}
    </span>
  );
}
