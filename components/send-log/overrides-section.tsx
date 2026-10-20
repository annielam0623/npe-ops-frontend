"use client";

import { useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { fetchSendOverrides, type SendOverride } from "@/lib/send-log-api";

import { formatSentAt } from "./config";
import { TABLE_CARD, TABLE_HEADER, TABLE_TITLE } from "./legacy";

const TH_CLASS =
  "border-b-[0.5px] border-black/[.08] night:border-white/10 bg-paper night:bg-white/[.03] px-2.5 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#1a1a1a] night:text-white/35";
const TD_CLASS = "px-2.5 py-2 align-top";

/** 接口里的 module 写成人看得懂的名字（Annie 2026-10-19 先这样叫，等她定）。 */
export function overrideModuleLabel(module: string): string {
  if (module.startsWith("morning_relay:"))
    return `Morning Relay (${module.slice("morning_relay:".length)})`;
  if (module === "farm_out_notice") return "Farm-out notice";
  if (module === "tickets_reminder") return "Tickets reminder";
  return module;
}

/** 每单的原因：所有单原因一样就只写一份，不一样就逐单写。 */
function reasonText(o: SendOverride): string {
  const per = o.orders.map((n) => [n, (o.reasons[n] ?? []).join("; ")]);
  const distinct = new Set(per.map(([, r]) => r));
  if (distinct.size <= 1) return [...distinct][0] || "—";
  return per.map(([n, r]) => `${n}: ${r || "—"}`).join(" · ");
}

/**
 * Send Log 的「Sent with an override」（G129）：哪些单是带着问题、有人点了 Send anyway 发出去的。
 * 跟着页面上的日期；只列订单号和原因。没有就不显示这一节（只写有事的）。
 */
export function OverridesSection({
  from,
  to,
  onUnauthorized,
}: {
  from: string;
  to: string;
  onUnauthorized: () => void;
}) {
  const [rows, setRows] = useState<SendOverride[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchSendOverrides(from, to, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setRows(r);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else setError(describeError(e));
      });
    return () => controller.abort();
  }, [from, to, onUnauthorized]);

  if (error)
    return (
      <p role="alert" className="mt-6 text-[12px] text-[#A32D2D]">
        Could not load the override list: {error}
      </p>
    );
  if (!rows?.length) return null;

  return (
    <section
      aria-label="Sent with an override"
      data-overrides
      className={`mt-6 ${TABLE_CARD}`}
    >
      <div className={TABLE_HEADER}>
        <span className={TABLE_TITLE}>Sent with an override</span>
        <span className="text-[11.5px] text-[#6b6b6b] night:text-white/35">
          Orders that went out with a problem someone chose to send anyway.
          Order numbers and reasons only.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={TH_CLASS}>Sent</th>
              <th className={TH_CLASS}>Module</th>
              <th className={TH_CLASS}>Tour date</th>
              <th className={TH_CLASS}>Orders</th>
              <th className={TH_CLASS}>Reason</th>
              <th className={TH_CLASS}>By</th>
            </tr>
          </thead>
          <tbody className="text-[#1a1a1a] night:text-white/75">
            {rows.map((o) => (
              <tr
                key={o.id}
                data-override={o.id}
                className="border-b-[0.5px] border-black/[.06] bg-[#fff8e1] last:border-b-0 night:border-white/10 night:bg-amber-400/10"
              >
                <td className={`${TD_CLASS} whitespace-nowrap`}>
                  {formatSentAt(o.created_at)}
                </td>
                <td className={`${TD_CLASS} whitespace-nowrap`}>
                  {overrideModuleLabel(o.module)}
                </td>
                <td className={`${TD_CLASS} whitespace-nowrap`}>
                  {o.run_date ?? "—"}
                </td>
                <td className={`${TD_CLASS} font-medium`}>
                  {o.orders.join(", ")}
                </td>
                <td className={TD_CLASS}>{reasonText(o)}</td>
                <td className={`${TD_CLASS} whitespace-nowrap`}>
                  {o.actor_name || o.actor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
