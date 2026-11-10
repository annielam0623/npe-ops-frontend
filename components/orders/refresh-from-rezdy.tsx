"use client";

import { useCallback, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { refreshOrderFromRezdy } from "@/lib/orders-api";
import type { OrderRefreshResult } from "@/types";

/**
 * Order 详情页「Refresh from Rezdy」（置顶 111，Annie「111， 112 全 A + 动手」，preview 第 2 版 6 题全 A）：
 * - 键在订单号那一行最右边，蓝色（点了直接改系统数据）；点了直接拉，不弹确认；Refreshing… 时灰掉。
 * - 只在新 Rezdy 表的单（后端原始 editable = false）、有 orders.edit 时出（后端 3e 挂 orders.edit）；partner 不出。
 * - 结果卡放订单号下面，一直留到离开页面或再按一次：updated 绿字原话 + 改了什么（Before → After）；
 *   not_applied、kept 黄框；出错红字原话、什么都没改。成功后整页静默重读（Guest / Product 卡直接是新值，Activity 多一条）。
 */

export type RefreshState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; data: OrderRefreshResult; at: Date }
  | { kind: "error"; message: string; at: Date };

export function useOrderRefresh(
  orderNumber: string,
  onRefreshed: () => void,
  onUnauthorized: () => void,
) {
  const [state, setState] = useState<RefreshState>({ kind: "idle" });
  const run = useCallback(async () => {
    setState({ kind: "busy" });
    try {
      const data = await refreshOrderFromRezdy(orderNumber);
      setState({ kind: "done", data, at: new Date() });
      if (data.result === "updated") onRefreshed();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setState({ kind: "error", message: describeError(e), at: new Date() });
    }
  }, [orderNumber, onRefreshed, onUnauthorized]);
  return { state, run };
}

export function RefreshButton({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-order-refresh
      disabled={busy}
      onClick={onClick}
      className="ml-auto h-[26px] cursor-pointer rounded-md bg-[#3b82f6] px-3 text-[12px] font-semibold text-white disabled:cursor-default disabled:opacity-60"
    >
      {busy ? "Refreshing…" : "Refresh from Rezdy"}
    </button>
  );
}

/** 后端把 kept 那句接在 message 后面：黄框里单独写，绿字里就去掉，不重复。 */
function splitKept(message: string): { main: string; keptText: string[] } {
  const parts = message.split(/(?<=\.)\s+(?=[A-Z])/);
  const keptText = parts.filter((p) => /kept the existing/i.test(p));
  const main = parts.filter((p) => !/kept the existing/i.test(p)).join(" ");
  return { main, keptText };
}

const AMBER =
  "mt-1.5 rounded-lg border border-[#f0d080] bg-[#fff8e1] px-2.5 py-1.5 text-[12.5px] text-[#7C4A00]";

export function RefreshResultCard({ state }: { state: RefreshState }) {
  if (state.kind !== "done" && state.kind !== "error") return null;
  const time = state.at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  let body: React.ReactNode;
  if (state.kind === "error") {
    body = (
      <p
        role="alert"
        data-order-refresh-error
        className="text-[13px] font-semibold text-[#B3261E] night:text-red-300"
      >
        {state.message}
      </p>
    );
  } else if (state.data.result === "not_applied") {
    body = (
      <div data-order-refresh-not-applied className={AMBER}>
        {state.data.message}
      </div>
    );
  } else {
    const { main, keptText } = splitKept(state.data.message);
    const kept = keptText.length
      ? keptText
      : state.data.kept.map(
          (f) =>
            `Rezdy has no ${f.toLowerCase()} for this order — kept the existing one.`,
        );
    body = (
      <>
        <p
          data-order-refresh-message
          className="text-[13px] font-semibold text-[#15803d] night:text-emerald-300"
        >
          {main}
        </p>
        {state.data.changed.length ? (
          <table
            data-order-refresh-changes
            className="mt-2 w-full border-collapse text-[12.5px] text-[#1a1a1a] night:text-white/90"
          >
            <thead>
              <tr className="text-left text-[11px] font-semibold text-[#555] night:text-white/55">
                <th className="border-b-[0.5px] border-black/15 px-1.5 py-1 night:border-white/15">
                  Field
                </th>
                <th className="border-b-[0.5px] border-black/15 px-1.5 py-1 night:border-white/15">
                  Before
                </th>
                <th className="w-[18px] border-b-[0.5px] border-black/15 night:border-white/15" />
                <th className="border-b-[0.5px] border-black/15 px-1.5 py-1 night:border-white/15">
                  After
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.changed.map((c, i) => (
                <tr
                  key={`${c.field}-${i}`}
                  data-order-refresh-change={c.field}
                  className="border-b-[0.5px] border-black/[.06] night:border-white/10"
                >
                  <td className="px-1.5 py-[5px]">{c.field}</td>
                  <td className="px-1.5 py-[5px] text-[#6b6b6b] line-through night:text-white/45">
                    {c.before ?? <Empty />}
                  </td>
                  <td className="text-center text-[#888]">→</td>
                  <td className="px-1.5 py-[5px]">{c.after ?? <Empty />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {kept.map((k) => (
          <div key={k} data-order-refresh-kept className={AMBER}>
            {k}
          </div>
        ))}
      </>
    );
  }
  return (
    <section
      aria-label="Refresh from Rezdy"
      data-order-refresh-result
      className="mt-3 mb-3 rounded-[10px] border-[0.5px] border-black/10 bg-paper px-4 py-3 night:border-white/10 night:bg-white/[.04]"
    >
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.6px] text-[#1a1a1a] uppercase night:text-white/35">
        Refresh from Rezdy
        <span className="font-normal tracking-normal text-[#6b6b6b] normal-case night:text-white/45">
          · {time}
        </span>
      </h3>
      {body}
    </section>
  );
}

function Empty() {
  return (
    <span className="inline-block text-[#aaa] italic night:text-white/35">
      empty
    </span>
  );
}
