"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { BroadcastLogEntry } from "@/types";

/**
 * Tour Tracking / Tickets Reminder Tracking 顶部压缩（Annie 2026-11-17 提，11-20 Excel 4③ A + 4⑥ B「动手」，样稿 v5
 * https://claude.ai/artifact/XkJzYXepzr6Yog9ciiFszr ）：原来表格上方的「📣 Broadcasts sent for this date」黄框不要了，
 * 改成 📣 Broadcast 键右上角一个小数字 = 当天已发条数（0 不标）。点小数字 ⇒ 键下展开当天列表（同原黄框，点一条看正文）；
 * 点键本身照旧开发送窗。
 */

const BTN =
  "flex cursor-pointer items-center gap-[5px] rounded-[7px] border-none bg-[linear-gradient(135deg,#ffce21,#ee8e00)] px-[11px] py-[4px] text-[11.5px] font-bold whitespace-nowrap text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60";

/** How to use 句子（两页共用；待 Annie 看原文）。 */
export const BROADCAST_COUNT_HOW_TO =
  "The small number on 📣 Broadcast is how many broadcasts were sent for this date; click the number to see what was sent, when and by whom.";

export function broadcastCountLabel(n: number) {
  return `${n} ${n === 1 ? "broadcast" : "broadcasts"} sent for this date — click to see ${n === 1 ? "it" : "them"}`;
}

/** 小圆数字（Broadcast 键上、手机 ⋯ 上共用）。 */
export function BroadcastCountDot({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-[18px] min-w-[18px] place-items-center rounded-[9px] border-2 border-white bg-[#b86a00] px-1 text-[10.5px] leading-none font-extrabold text-white tabular-nums",
        className,
      )}
    >
      {count}
    </span>
  );
}

export function BroadcastButton({
  items,
  onOpen,
  disabled,
  className,
  phone,
}: {
  items: BroadcastLogEntry[];
  onOpen: () => void;
  disabled?: boolean;
  className?: string;
  /** 手机 ⋯ 里的那一份（测试用来区分）。 */
  phone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const n = items.length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      data-broadcast-wrap={phone ? "phone" : "desktop"}
      className={cn("relative inline-flex", className)}
    >
      <button
        type="button"
        data-broadcast-button
        {...(phone ? { "data-phone-broadcast": "" } : {})}
        onClick={onOpen}
        disabled={disabled}
        className={BTN}
      >
        📣 Broadcast
      </button>
      {n ? (
        <button
          type="button"
          data-broadcast-count
          data-phone-keep
          aria-expanded={open}
          aria-label={broadcastCountLabel(n)}
          title={broadcastCountLabel(n)}
          onClick={() => setOpen((v) => !v)}
          className="absolute -top-2 -right-2 cursor-pointer"
        >
          <BroadcastCountDot count={n} />
        </button>
      ) : null}
      {open && n ? (
        <section
          data-broadcast-panel
          className="absolute top-[calc(100%+6px)] right-0 z-30 w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-[#f0d080] bg-[#fffbea] text-left shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
        >
          <h2 className="bg-[#fff3cd] px-3 py-1.5 text-[11px] font-bold text-[#7a4f00]">
            📣 Broadcasts sent for this date ({n})
          </h2>
          <div className="max-h-[50vh] overflow-y-auto">
            {items.map((b) => (
              <details
                key={b.id}
                className="group border-t border-[#f0dfae]"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-2 px-3 py-[7px] text-[10px] text-[#8a6d1f] [&::-webkit-details-marker]:hidden">
                  <span className="text-[9px] group-open:hidden">▶</span>
                  <span className="hidden text-[9px] group-open:inline">▼</span>
                  <span className="text-[11px] font-bold text-[#7a4f00]">
                    {b.template_name || "Custom message"}
                  </span>
                  <span>{b.created_at}</span>
                  <span>· {b.sent_by}</span>
                </summary>
                <p className="px-3 pb-2 text-[11px] leading-[1.5] whitespace-pre-wrap text-[#4a3a1a]">
                  {b.message_body}
                </p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </span>
  );
}
