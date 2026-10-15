"use client";

import { useState } from "react";

import {
  MONO,
  TD,
  TH,
  TM_BTN,
  TM_BTN_BLUE,
  TM_PAD,
} from "@/components/dispatch/legacy-styles";
import { LA_TIME_ZONE } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type { DispatchPendingItem } from "@/types";

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  timeStyle: "short",
});

const KIND: Record<
  DispatchPendingItem["kind"],
  { label: string; cls: string }
> = {
  added: { label: "New order", cls: "bg-[#e6f4ec] text-[#1e6b43]" },
  removed: { label: "Cancelled", cls: "bg-[#fdeceb] text-[#b3261e]" },
  changed: { label: "Changed", cls: "bg-[#e8f0fd] text-[#1d4ed8]" },
};

/** 一句「要做什么」：只按变化前在哪台车写，不替 staff 判断（Annie 2026-10-12：系统不判断）。 */
export function pendingTodo(item: DispatchPendingItem): string {
  const parts: string[] = [];
  if (item.kind === "added")
    parts.push("Not on a bus yet: pick a bus in Step 2");
  else if (item.old_bus)
    parts.push(
      `Was on Bus ${item.old_bus}: update the manifest, tell the driver`,
    );
  else parts.push("Update the manifest");
  // relay（后端 G56 最终版 350a7c4）：「1st Round · 2656 · Driver A」这类短句前面加 Morning Relay:；
  // 本身就以 Morning Relay 开头的（例如「Morning Relay · Need a look」）原样用，不重复。"" = 不影响 Relay。
  if (item.relay)
    parts.push(
      /^morning relay\b/i.test(item.relay)
        ? item.relay
        : `Morning Relay: ${item.relay}`,
    );
  return parts.join(" · ");
}

/**
 * Step 1 顶上的「Completed 之后的变化」（后端 G56，Annie 2026-10-12）：staff 点了 Completed 以后名单又变了的单，
 * 一单一行，逐条 Handled 或一次 All handled（后端记谁、几点）。只给 staff 看，不进司机 / 导游页。没有没处理的就不显示。
 */
export function PendingChanges({
  items,
  onHandled,
}: {
  items: DispatchPendingItem[];
  /** 标已处理；返回前由调用方重读。抛错 = 没标上。 */
  onHandled: (which: { ids: number[] } | { all: true }) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"all" | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return null;

  async function handle(
    which: { ids: number[] } | { all: true },
    key: "all" | number,
  ) {
    setBusy(key);
    setError(null);
    try {
      await onHandled(which);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const n = items.length;
  return (
    <div
      role="region"
      aria-label="Changes after Completed"
      data-pending
      className="overflow-hidden rounded-[10px] bg-white text-[#111827]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e5e7eb] px-[18px] py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-[650] text-[#c2410c]">
            {n} change{n === 1 ? "" : "s"} after Completed
          </div>
          <div className="mt-0.5 text-[13px] text-[#1a1a1a]">
            Update what was already sent (Bus Manifest, driver, guide), then
            mark each one handled.
          </div>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void handle({ all: true }, "all")}
          className={TM_BTN_BLUE}
        >
          {busy === "all" ? "Saving…" : "All handled"}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="m-0 px-[18px] pt-2 text-[12.5px] text-[#b3261e]"
        >
          Not marked handled: {error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr>
              {[
                "Tour",
                "Change",
                "Order #",
                "What changed",
                "To do",
                "When",
                "",
              ].map((h, i) => (
                <th key={i} className={cn(TH, "py-[7px]")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} data-pending-item={it.id} data-kind={it.kind}>
                <td className={cn(TD, TM_PAD, "whitespace-nowrap")}>
                  {it.tour}
                </td>
                <td className={cn(TD, TM_PAD)}>
                  <span
                    className={cn(
                      "inline-block rounded-[5px] px-[7px] py-0.5 text-[11.5px] font-semibold whitespace-nowrap",
                      KIND[it.kind].cls,
                    )}
                  >
                    {KIND[it.kind].label}
                  </span>
                </td>
                <td className={cn(TD, TM_PAD, MONO)}>{it.order_number}</td>
                <td className={cn(TD, TM_PAD, "min-w-[200px]")}>{it.detail}</td>
                <td
                  className={cn(
                    TD,
                    TM_PAD,
                    "min-w-[200px] text-[12.5px] font-[650] text-[#c2410c]",
                  )}
                >
                  {pendingTodo(it)}
                </td>
                <td
                  className={cn(
                    TD,
                    TM_PAD,
                    "text-[12.5px] whitespace-nowrap text-[#1a1a1a]",
                  )}
                >
                  {TIME.format(new Date(it.created_at))}
                </td>
                <td className={cn(TD, TM_PAD, "text-right")}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handle({ ids: [it.id] }, it.id)}
                    className={TM_BTN}
                  >
                    {busy === it.id ? "Saving…" : "Handled"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
