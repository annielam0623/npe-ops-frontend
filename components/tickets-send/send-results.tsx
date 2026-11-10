import { sendBatchHref } from "@/lib/send-log-api";
import { channelCell, countOutcomes, outcomeStats } from "@/lib/send-outcome";
import { cn } from "@/lib/utils";
import type {
  TicketsGuest,
  TicketsSendResult,
  TicketsSendType,
  TicketsSkipped,
} from "@/types";

import { sendTypeShort, ticketRowOutcome } from "./config";
import {
  LIGHT_BUTTON,
  RESULT_CARD,
  RESULT_SUMMARY,
  ResultStat,
  SendProgress,
  sendButtonClass,
  STOP_BOX,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
} from "./legacy-ui";

/** 中途停下：原因 + 状态不明的那一批（请求发出去了但没拿到结果）。 */
export interface SendStop {
  reason: string;
  uncertain: TicketsGuest[];
  /** 断开 / 超时 / 服务器出错：这一批可能已经在服务器上发出去了。 */
  maybeSent?: boolean;
}

export function SendResults({
  sending,
  tourLabel,
  serviceDate,
  sendType,
  guests,
  results,
  skipped,
  processed,
  stop,
  batchId = null,
  onStartOver,
}: {
  sending: boolean;
  tourLabel: string;
  serviceDate: string;
  sendType: TicketsSendType;
  guests: TicketsGuest[];
  results: TicketsSendResult[];
  skipped: TicketsSkipped[];
  processed: number;
  stop: SendStop | null;
  batchId?: number | null;
  onStartOver: () => void;
}) {
  const uncertainCount = stop?.uncertain.length ?? 0;
  const notAttemptedGuests = stop
    ? guests.slice(processed + uncertainCount)
    : [];
  // 服务端跳过的客人不在 results 里：按订单号对回客人（同一单不会出现两次，预览已经拦过）。
  const guestByOrder = new Map(guests.map((g) => [g.chd_number, g]));
  // 置顶 109：一位客人一个结论，后端 outcome 优先；没号码 / 没邮箱不算失败。
  const rows = results.map((r) => ({
    r,
    o: ticketRowOutcome(sendType, guestByOrder.get(r.chd_number), r),
  }));
  const counts = countOutcomes(rows.map((x) => x.o.outcome));

  return (
    <section className={RESULT_CARD}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
          {sending ? "Sending…" : "📬 Send Results"}
        </h2>
        <span className="text-[12px] text-[#1a1a1a]">
          {tourLabel} · {serviceDate} · {sendTypeShort(sendType)}
        </span>
      </div>

      {sending ? (
        <SendProgress done={processed} total={guests.length} theme="orange">
          {processed} of {guests.length} done — keep this page open until Send
          Results appears.
        </SendProgress>
      ) : null}

      {stop ? (
        <div role="alert" className={cn(STOP_BOX, "mb-4")}>
          {stop.maybeSent ? (
            <>
              <p className="font-semibold">
                ⛔ The page lost contact with the server. Some or all reminders
                may already have been sent.
              </p>
              <p>
                Do not send again yet. Open{" "}
                <a
                  href={batchId ? sendBatchHref(batchId) : "/send-log"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {batchId ? "this send in the Send Log" : "the Send Log"}
                </a>{" "}
                and check which orders were sent. To send the rest, click Send
                Another and upload the file again: orders already sent are
                marked Duplicate and skipped.
              </p>
              <p className="text-[11px]">({stop.reason})</p>
            </>
          ) : (
            <p className="font-semibold">Sending stopped: {stop.reason}</p>
          )}
          {uncertainCount > 0 ? (
            <p>
              {uncertainCount} guest{uncertainCount === 1 ? "" : "s"} (
              {stop.uncertain.map((g) => g.chd_number).join(", ")}) may or may
              not have been sent.
            </p>
          ) : null}
          {notAttemptedGuests.length > 0 ? (
            <p>
              {notAttemptedGuests.length} guest
              {notAttemptedGuests.length === 1 ? " was" : "s were"} not sent:{" "}
              {notAttemptedGuests.map((g) => g.chd_number).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={RESULT_SUMMARY}>
        {outcomeStats(counts).map((s) => (
          <ResultStat
            key={s.label}
            label={s.label}
            value={s.value}
            className={s.className}
          />
        ))}
        <ResultStat
          label="Skipped"
          value={skipped.length}
          className="text-[#1a1a1a]"
        />
        <ResultStat
          label="Total"
          // 页面没送去的（没有 reason）+ 送去的；服务端跳过的已经算在送去的里。
          value={guests.length + skipped.filter((s) => !s.reason).length}
        />
      </div>

      {results.length > 0 || skipped.length > 0 ? (
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>CHD#</th>
                <th className={TH}>Name</th>
                <th className={TH}>Email Status</th>
                <th className={TH}>SMS Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, o }, i) => {
                const email = channelCell("email", o.email);
                const sms = channelCell("sms", o.sms);
                return (
                  <tr key={`r${i}`} data-outcome={o.outcome} className={TR}>
                    <td className={TD}>{r.chd_number}</td>
                    <td className={TD}>{r.name}</td>
                    <td className={cn(TD, email.className)}>{email.label}</td>
                    <td className={cn(TD, sms.className)}>{sms.label}</td>
                  </tr>
                );
              })}
              {skipped.map((s, i) => (
                <tr key={`s${i}`} data-skipped className={TR}>
                  <td className={TD}>{s.chd_number || "—"}</td>
                  <td className={TD}>{s.name}</td>
                  <td colSpan={2} className={cn(TD, "text-[#1a1a1a]")}>
                    Skipped: {s.message || s.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!sending ? (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {batchId ? (
            <a
              href={sendBatchHref(batchId)}
              target="_blank"
              rel="noopener noreferrer"
              className={sendButtonClass("orange")}
            >
              📋 View this send
            </a>
          ) : null}
          <button type="button" onClick={onStartOver} className={LIGHT_BUTTON}>
            ↩ Send Another
          </button>
        </div>
      ) : null}
    </section>
  );
}
