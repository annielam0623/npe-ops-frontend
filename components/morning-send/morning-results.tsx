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

/**
 * 逐单表每个渠道的写法，和 Tickets / Tour 结果页一模一样（Annie 2026-10-20：morning 的算法要跟 tour 和
 * ticket 的一样，分开算，分开显示）：Sent 琥珀色 / Failed 红 / No address / — 没选这个渠道。
 */
type ChannelOutcome = "sent" | "failed" | "no-address" | "not-selected";
const OUTCOME: Record<ChannelOutcome, { label: string; className: string }> = {
  sent: { label: "Sent", className: "font-medium text-[#BA7517]" },
  failed: { label: "Failed", className: "text-[#A32D2D]" },
  "no-address": { label: "No address", className: "text-[#1a1a1a]" },
  "not-selected": { label: "—", className: "text-[#1a1a1a]" },
};

/**
 * 一个渠道的结果。后端没邮箱时不发、email_status 留空；没手机号时照样调短信接口、记 failed，
 * 所以短信看号码本身（同 isResultNoAddress）。
 */
function channelOutcome(
  channel: "sms" | "email",
  sendType: MorningSendType,
  r: MorningSendResult,
): ChannelOutcome {
  if (sendType !== "combined" && sendType !== channel) return "not-selected";
  const raw = channel === "sms" ? r.sms_status : r.email_status;
  if (channelStatus(raw).tone === "sent") return "sent";
  if (channel === "sms" ? !(r.phone ?? "").trim() : !raw) return "no-address";
  return "failed";
}

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
  alreadySent = 0,
  label = "Morning Pickup · today",
  stop,
  onStartOver,
  onClose,
}: {
  sending: boolean;
  sendType: MorningSendType;
  /** 本次要发的订单号，按发送顺序。 */
  orders: string[];
  /** 已经拿到结果的（只含选中的行，按发送顺序）。 */
  results: MorningSendResult[];
  /** 文件里没选中的行数；不传就不显示这一格（Dispatch 的 Morning Relay 没有勾选）。 */
  notSelected?: number;
  /** 服务端发之前就跳过、不在 results 里的（Morning Relay 的「已经发过」只给个数），算进 Skipped。 */
  alreadySent?: number;
  /** 标题右边那行小字。 */
  label?: string;
  stop: MorningSendStop | null;
  /** 不传就没有 Send Another（Morning Relay 发完留在 Dispatch 上）。 */
  onStartOver?: () => void;
  /** 传了就在右上角多一个 ✕ Close，收起这张结果（Morning Relay 用，Annie 2026-10-14）。 */
  onClose?: () => void;
}) {
  // 服务端查重跳过的（Already sent today / Listed twice in this file）：没发，单独算。
  const skippedInResults = results.filter((r) => r.skipped).length;
  // 不在 results 里的「以前发过」只加进 Skipped 这一格，不参与下面 Failed 的减法。
  const skipped = skippedInResults + alreadySent;
  const sent = results.filter(isResultSent).length;
  const noAddress = results.filter((r) =>
    isResultNoAddress(r, sendType),
  ).length;
  const failed = results.length - skippedInResults - sent - noAddress;
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
        <span className="flex items-center gap-3">
          <span className="text-[12px] text-[#1a1a1a]">
            {label} · {sendTypeShort(sendType)}
          </span>
          {onClose && !sending ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the send results"
              className={cn(LIGHT_BUTTON, "h-7 px-2.5 text-[12px]")}
            >
              ✕ Close
            </button>
          ) : null}
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
        <ResultStat label="Sent" value={sent} className="text-[#BA7517]" />
        <ResultStat label="Failed" value={failed} className="text-[#A32D2D]" />
        <ResultStat
          label="No address"
          value={noAddress}
          className="text-[#1a1a1a]"
        />
        <ResultStat
          label="Skipped"
          value={skipped}
          className="text-[#1a1a1a]"
        />
        {/* 和 Tickets / Tour 一样最后一格是 Total：文件里的全部订单（本次发的 + 没勾选的 + 以前发过的）。 */}
        <ResultStat
          label="Total"
          value={orders.length + (notSelected ?? 0) + alreadySent}
        />
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
                <th className={TH}>Email Status</th>
                <th className={TH}>SMS Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const left = (
                  <>
                    <td className={TD}>{r.order}</td>
                    <td className={TD}>{r.name}</td>
                    <td className={cn(TD, "text-[11px]")}>{r.phone}</td>
                    <td className={TD}>{r.pickup_time}</td>
                  </>
                );
                // 服务端跳过的：两列并成一格写原因（同 Tickets / Tour）。
                if (r.skipped) {
                  return (
                    <tr
                      key={`${r.order}-${i}`}
                      data-skipped
                      className={TR}
                    >
                      {left}
                      <td colSpan={2} className={cn(TD, "text-[#1a1a1a]")}>
                        Skipped: {r.message || "Skipped"}
                      </td>
                    </tr>
                  );
                }
                const email = OUTCOME[channelOutcome("email", sendType, r)];
                const sms = OUTCOME[channelOutcome("sms", sendType, r)];
                return (
                  <tr key={`${r.order}-${i}`} className={TR}>
                    {left}
                    <td
                      title={channelStatus(r.email_status).label}
                      className={cn(TD, email.className)}
                    >
                      {email.label}
                    </td>
                    <td
                      title={channelStatus(r.sms_status).label}
                      className={cn(TD, sms.className)}
                    >
                      {sms.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!sending && onStartOver ? (
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
