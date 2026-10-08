import {
  LIGHT_BUTTON,
  RESULT_CARD,
  RESULT_SUMMARY,
  ResultStat,
  SendProgress,
  STOP_BOX,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
} from "@/components/tickets-send/legacy-ui";
import { cn } from "@/lib/utils";
import type { MorningSendResult, MorningSendType } from "@/types";

import { channelStatus, sendTypeShort } from "./config";

/** 中途停下：原因 + 状态不明的那一批订单号（请求发出去了但没拿到结果）。 */
export interface MorningSendStop {
  reason: string;
  uncertain: string[];
}

/** 旧页面 .status-ok / .status-fail / .status-skip。 */
const TONE_CLASS = {
  sent: "font-medium text-[#185FA5]",
  failed: "text-[#A32D2D]",
  skip: "text-[#BA7517]",
  none: "",
} as const;

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
  if (r.skipped || isResultSent(r)) return false;
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
  // 服务端查重跳过的（Already sent today / Listed twice in this file）：没发，单独算。
  const skipped = results.filter((r) => r.skipped).length;
  const sent = results.filter(isResultSent).length;
  const noAddress = results.filter((r) =>
    isResultNoAddress(r, sendType),
  ).length;
  const failed = results.length - skipped - sent - noAddress;
  // 进度按订单算：文件里同一单第二行（Listed twice）也会回一条结果。
  const doneOrders = new Set(results.map((r) => r.order));
  const uncertain = new Set(stop?.uncertain ?? []);
  const notAttempted = stop
    ? orders.filter((o) => !doneOrders.has(o) && !uncertain.has(o))
    : [];

  return (
    <section className={RESULT_CARD}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
          {sending ? "Sending…" : "📬 Send Results"}
        </h2>
        <span className="text-[12px] text-[#888]">
          Morning Pickup · today · {sendTypeShort(sendType)}
        </span>
      </div>

      {sending ? (
        <SendProgress done={doneOrders.size} total={orders.length} theme="blue">
          {doneOrders.size} of {orders.length} done — keep this page open.
        </SendProgress>
      ) : null}

      {stop ? (
        <div role="alert" className={cn(STOP_BOX, "mb-4")}>
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

      <div className={RESULT_SUMMARY}>
        <ResultStat label="Sent" value={sent} className="text-[#185FA5]" />
        <ResultStat label="Failed" value={failed} className="text-[#A32D2D]" />
        <ResultStat
          label="No address"
          value={noAddress}
          className="text-[#BA7517]"
        />
        <ResultStat
          label="Skipped"
          value={skipped}
          className="text-[#BA7517]"
        />
        <ResultStat
          label="Not selected"
          value={notSelected}
          className="text-[#888]"
        />
        <ResultStat label="To send" value={orders.length} />
      </div>

      {results.length > 0 ? (
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Order #</th>
                <th className={TH}>Name</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Pickup Time</th>
                <th className={TH}>SMS Status</th>
                <th className={TH}>Email Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                // 跳过的两列都写原因（同旧页面）。
                const skip = r.skipped
                  ? ({ label: r.message || "Skipped", tone: "skip" } as const)
                  : null;
                const sms = skip ?? channelStatus(r.sms_status);
                const email = skip ?? channelStatus(r.email_status);
                return (
                  <tr key={`${r.order}-${i}`} className={TR}>
                    <td className={TD}>{r.order}</td>
                    <td className={TD}>{r.name}</td>
                    <td className={cn(TD, "text-[11px]")}>{r.phone}</td>
                    <td className={TD}>{r.pickup_time}</td>
                    <td className={cn(TD, TONE_CLASS[sms.tone])}>
                      {sms.label}
                    </td>
                    <td className={cn(TD, TONE_CLASS[email.tone])}>
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
        <button
          type="button"
          onClick={onStartOver}
          className={cn(LIGHT_BUTTON, "mt-4")}
        >
          ↩ Send Another
        </button>
      ) : null}
    </section>
  );
}
