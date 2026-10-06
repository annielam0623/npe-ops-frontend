import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";
import type { MorningSendResult, MorningSendType } from "@/types";

import { channelStatus, sendTypeShort } from "./config";

/** 中途停下：原因 + 状态不明的那一批订单号（请求发出去了但没拿到结果）。 */
export interface MorningSendStop {
  reason: string;
  uncertain: string[];
}

const TONE_CLASS = {
  sent: "text-[#1a6b3c] font-medium",
  failed: "text-[#A32D2D] font-medium",
  none: "text-stone-400",
} as const;

const TH_CLASS =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-500";
const TD_CLASS = "px-3 py-2 whitespace-nowrap";

export function isResultSent(r: MorningSendResult): boolean {
  return (
    channelStatus(r.sms_status).tone === "sent" ||
    channelStatus(r.email_status).tone === "sent"
  );
}

/**
 * 一条都没发、而且选了的渠道都是因为没地址（没手机号 / 没邮箱）：单独算 No address，不算失败。
 * 后端没邮箱时不发、email_status 留空；没手机号时照样调短信接口，记 failed，所以看号码本身。
 */
export function isResultNoAddress(
  r: MorningSendResult,
  sendType: MorningSendType,
): boolean {
  if (isResultSent(r)) return false;
  const smsNoAddress = sendType === "email" || !(r.phone ?? "").trim();
  const emailNoAddress = sendType === "sms" || !r.email_status;
  return smsNoAddress && emailNoAddress;
}

export function MorningResults({
  sending,
  sendType,
  orders,
  results,
  notSelected,
  stop,
  onStartOver,
}: {
  sending: boolean;
  sendType: MorningSendType;
  /** 本次要发的订单号，按发送顺序。 */
  orders: string[];
  /** 已经拿到结果的（只含选中的行，按发送顺序）。 */
  results: MorningSendResult[];
  /** 文件里没选中的行数。 */
  notSelected: number;
  stop: MorningSendStop | null;
  onStartOver: () => void;
}) {
  const sent = results.filter(isResultSent).length;
  const noAddress = results.filter((r) =>
    isResultNoAddress(r, sendType),
  ).length;
  const failed = results.length - sent - noAddress;
  const doneOrders = new Set(results.map((r) => r.order));
  const uncertain = new Set(stop?.uncertain ?? []);
  const notAttempted = stop
    ? orders.filter((o) => !doneOrders.has(o) && !uncertain.has(o))
    : [];

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">
          {sending ? "Sending…" : "Send Results"}
        </h2>
        <span className="text-xs text-stone-500">
          Morning Pickup · today · {sendTypeShort(sendType)}
        </span>
      </div>

      {sending ? (
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={orders.length}
            aria-valuenow={results.length}
            className="h-2 overflow-hidden rounded-full bg-stone-100"
          >
            <div
              className="h-full bg-[#185FA5] transition-[width]"
              style={{
                width: `${orders.length ? (results.length / orders.length) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-sm text-stone-600 tabular-nums">
            {results.length} of {orders.length} done — keep this page open.
          </p>
        </div>
      ) : null}

      {stop ? (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-md border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-3 text-sm text-[#A32D2D]"
        >
          <p className="font-semibold">Sending stopped: {stop.reason}</p>
          {uncertain.size > 0 ? (
            <p>
              {uncertain.size} order{uncertain.size === 1 ? "" : "s"} (
              {[...uncertain].join(", ")}) may or may not have been sent. Check
              the Send Log before sending them again.
            </p>
          ) : null}
          {notAttempted.length > 0 ? (
            <p>
              {notAttempted.length} order
              {notAttempted.length === 1 ? " was" : "s were"} not sent:{" "}
              {notAttempted.join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Stat label="Sent" value={sent} className="text-[#185FA5]" />
        <Stat label="Failed" value={failed} className="text-[#A32D2D]" />
        <Stat label="No address" value={noAddress} className="text-[#BA7517]" />
        <Stat
          label="Not selected"
          value={notSelected}
          className="text-stone-500"
        />
        <Stat
          label="To send"
          value={orders.length}
          className="text-stone-900"
        />
      </div>

      {results.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={TH_CLASS}>Order #</th>
                <th className={TH_CLASS}>Name</th>
                <th className={TH_CLASS}>Phone</th>
                <th className={TH_CLASS}>Pickup Time</th>
                <th className={TH_CLASS}>SMS</th>
                <th className={TH_CLASS}>Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {results.map((r, i) => {
                const sms = channelStatus(r.sms_status);
                const email = channelStatus(r.email_status);
                return (
                  <tr key={`${r.order}-${i}`}>
                    <td className={TD_CLASS}>{r.order}</td>
                    <td className={TD_CLASS}>{r.name}</td>
                    <td className={`${TD_CLASS} text-xs`}>{r.phone}</td>
                    <td className={TD_CLASS}>{r.pickup_time}</td>
                    <td className={cn(TD_CLASS, TONE_CLASS[sms.tone])}>
                      {sms.label}
                    </td>
                    <td className={cn(TD_CLASS, TONE_CLASS[email.tone])}>
                      {email.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!sending ? (
        <div>
          <button
            type="button"
            onClick={onStartOver}
            className={SECONDARY_BUTTON_CLASS}
          >
            ↩ Send Another
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <div className="min-w-[96px] rounded-md bg-stone-50 px-4 py-2.5 text-center">
      <div className={cn("text-2xl font-bold tabular-nums", className)}>
        {value}
      </div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
}
