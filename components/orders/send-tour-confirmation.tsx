"use client";

import { useCallback, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { sendTourOrder } from "@/lib/manifests-api";
import {
  channelCell,
  failedReason,
  legacyChannel,
  resolveOutcome,
} from "@/lib/send-outcome";
import { cn } from "@/lib/utils";
import type { ManifestSendTourResult } from "@/types";

/**
 * Order 详情页「Send tour confirmation」（G297，Annie 2026-11-12「同意A，动手」，原文：
 * 「Order 页上加一个「Send tour confirmation」键，staff 点一下就发，发成功 Notice 自动消。人看过酒店对了再发」）。
 * - 键跟 Refresh from Rezdy 放一起（订单号那一行最右边），蓝色（提交键）；点了直接发，Sending… 时灰掉。
 * - 日期：网址的 tour_date（Notice 链接带的），没有就用订单的 Tour date；都没有就灰掉、旁边一行小字说明。
 * - 结果卡放订单号下面（同 Refresh 的结果卡）：一行 Order / Name / Email Status / SMS Status，照统一的发送结果
 *   （成功绿、失败红、没地址灰）；后端留下没发的（酒店还空着等）红字写原因；请求被拒红字原话。
 */

export type SendOrderState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; data: ManifestSendTourResult; at: Date }
  | { kind: "error"; message: string; at: Date };

/** 网址 tour_date（YYYY-MM-DD）优先；否则订单的 Tour date（MM/DD/YYYY）；都没有 = null。 */
export function sendDateFor(
  urlDate: string | null,
  productDate: string | null | undefined,
): string | null {
  if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) return urlDate;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((productDate ?? "").trim());
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function useSendTourOrder(
  orderNumber: string,
  onUnauthorized: () => void,
) {
  const [state, setState] = useState<SendOrderState>({ kind: "idle" });
  const run = useCallback(
    async (date: string) => {
      setState({ kind: "busy" });
      try {
        const data = await sendTourOrder({ date, order_number: orderNumber });
        setState({ kind: "done", data, at: new Date() });
      } catch (e) {
        if (isStatus(e, 401)) {
          onUnauthorized();
          return;
        }
        setState({ kind: "error", message: describeError(e), at: new Date() });
      }
    },
    [orderNumber, onUnauthorized],
  );
  return { state, run };
}

export function SendTourButton({
  busy,
  date,
  onClick,
}: {
  busy: boolean;
  date: string | null;
  onClick: () => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {date ? null : (
        <span
          data-order-send-no-date
          className="text-[11.5px] text-[#6b6b6b] night:text-white/55"
        >
          No tour date for this order, so it cannot be sent from here.
        </span>
      )}
      <button
        type="button"
        data-order-send-tour
        disabled={busy || !date}
        onClick={onClick}
        className="h-[26px] cursor-pointer rounded-md bg-[#3b82f6] px-3 text-[12px] font-semibold text-white disabled:cursor-default disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send tour confirmation"}
      </button>
    </span>
  );
}

const TH =
  "border-b-[0.5px] border-black/15 px-1.5 py-1 text-left text-[11px] font-semibold text-[#555] night:border-white/15 night:text-white/55";
const TD = "px-1.5 py-[5px]";
const RED = "text-[#B3261E] night:text-red-300";

export function SendTourResultCard({ state }: { state: SendOrderState }) {
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
        data-order-send-error
        className={cn("text-[13px] font-semibold", RED)}
      >
        {state.message}
      </p>
    );
  } else {
    const groups = state.data.groups ?? [];
    const results = groups.flatMap((g) => g.results ?? []);
    const skipped = groups.flatMap((g) => g.skipped ?? []);
    const blocked = groups.flatMap((g) => g.blocked ?? []);
    const outcomes = results.map((r) => ({
      r,
      o: resolveOutcome(r, {
        sms: legacyChannel(r.sms_status, true),
        email: legacyChannel(r.email_status, true),
      }),
    }));
    const sent = outcomes.some(({ o }) => o.outcome === "sent");
    body = (
      <>
        <p
          data-order-send-headline={sent ? "sent" : "not_sent"}
          className={cn(
            "text-[13px] font-semibold",
            sent ? "text-[#15803d] night:text-emerald-300" : RED,
          )}
        >
          {sent ? "✓ Tour confirmation sent." : "Not sent."}
        </p>
        <table className="mt-2 w-full border-collapse text-[12.5px] text-[#1a1a1a] night:text-white/90">
          <thead>
            <tr>
              <th className={TH}>Order #</th>
              <th className={TH}>Name</th>
              <th className={TH}>Email Status</th>
              <th className={TH}>SMS Status</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map(({ r, o }, i) => {
              const email = channelCell(
                "email",
                o.email,
                failedReason(r.email_status),
              );
              const sms = channelCell("sms", o.sms, failedReason(r.sms_status));
              return (
                <tr key={`r${i}`} data-outcome={o.outcome}>
                  <td className={TD}>{r.order}</td>
                  <td className={TD}>{r.name}</td>
                  <td className={cn(TD, email.className)}>{email.label}</td>
                  <td className={cn(TD, sms.className)}>{sms.label}</td>
                </tr>
              );
            })}
            {skipped.map((s, i) => (
              <tr
                key={`s${i}`}
                data-skipped={s.reason || true}
                className="bg-[#fdecec] night:bg-red-400/10"
              >
                <td className={TD}>{s.order_number || s.chd_number || "—"}</td>
                <td className={TD}>{s.name}</td>
                <td colSpan={2} className={cn(TD, RED)}>
                  Not sent: {s.message || s.reason}
                </td>
              </tr>
            ))}
            {blocked.map((b, i) => (
              <tr
                key={`b${i}`}
                data-blocked
                className="bg-[#fdecec] night:bg-red-400/10"
              >
                <td className={TD}>{b.order_number}</td>
                <td className={TD} />
                <td colSpan={2} className={cn(TD, RED)}>
                  Not sent: {b.reasons.join(" ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  return (
    <section
      aria-label="Send tour confirmation"
      data-order-send-result
      className="mt-3 mb-3 rounded-[10px] border-[0.5px] border-black/10 bg-paper px-4 py-3 night:border-white/10 night:bg-white/[.04]"
    >
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.6px] text-[#1a1a1a] uppercase night:text-white/35">
        Send tour confirmation
        <span className="font-normal tracking-normal text-[#6b6b6b] normal-case night:text-white/45">
          · {time}
        </span>
      </h3>
      {body}
    </section>
  );
}
