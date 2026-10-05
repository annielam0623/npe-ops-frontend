import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { sendBatchHref } from "@/lib/send-log-api";
import { cn } from "@/lib/utils";
import type {
  TicketsGuest,
  TicketsSendResult,
  TicketsSendType,
  TicketsSkipped,
} from "@/types";

import {
  type ChannelOutcome,
  channelOutcome,
  isGuestSent,
  sendTypeShort,
} from "./config";

/** 中途停下：原因 + 状态不明的那一批（请求发出去了但没拿到结果）。 */
export interface SendStop {
  reason: string;
  uncertain: TicketsGuest[];
  /** 断开 / 超时 / 服务器出错：这一批可能已经在服务器上发出去了。 */
  maybeSent?: boolean;
}

const OUTCOME: Record<ChannelOutcome, { label: string; className: string }> = {
  sent: { label: "Sent", className: "text-[#1a6b3c] font-medium" },
  failed: { label: "Failed", className: "text-[#A32D2D] font-medium" },
  "no-address": { label: "No address", className: "text-stone-400" },
  "not-selected": { label: "—", className: "text-stone-300" },
};

const TH_CLASS =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-500";
const TD_CLASS = "px-3 py-2 whitespace-nowrap";

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
  const sent = results.filter(isGuestSent).length;
  const failed = results.length - sent;
  const uncertainCount = stop?.uncertain.length ?? 0;
  const notAttemptedGuests = stop
    ? guests.slice(processed + uncertainCount)
    : [];
  // 服务端跳过的客人不在 results 里：按订单号对回客人（同一单不会出现两次，预览已经拦过）。
  const guestByOrder = new Map(guests.map((g) => [g.chd_number, g]));

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">
          {sending ? "Sending…" : "Send Results"}
        </h2>
        <span className="text-xs text-stone-500">
          {tourLabel} · {serviceDate} · {sendTypeShort(sendType)}
        </span>
      </div>

      {sending ? (
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={guests.length}
            aria-valuenow={processed}
            className="h-2 overflow-hidden rounded-full bg-stone-100"
          >
            <div
              className="h-full bg-[#BA7517] transition-[width]"
              style={{
                width: `${guests.length ? (processed / guests.length) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-sm text-stone-600 tabular-nums">
            {processed} of {guests.length} done — keep this page open until Send
            Results appears.
          </p>
        </div>
      ) : null}

      {stop ? (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-md border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-3 text-sm text-[#A32D2D]"
        >
          {stop.maybeSent ? (
            <>
              <p className="font-semibold">
                The page lost contact with the server. Some or all reminders may
                already have been sent.
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
              <p className="text-xs">({stop.reason})</p>
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

      <div className="flex flex-wrap gap-3">
        <Stat label="Sent" value={sent} className="text-[#BA7517]" />
        <Stat label="Failed" value={failed} className="text-[#A32D2D]" />
        <Stat
          label="Skipped"
          value={skipped.length}
          className="text-stone-500"
        />
        <Stat
          label="Total"
          // 页面没送去的（没有 reason）+ 送去的；服务端跳过的已经算在送去的里。
          value={guests.length + skipped.filter((s) => !s.reason).length}
          className="text-stone-900"
        />
      </div>

      {results.length > 0 || skipped.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={TH_CLASS}>CHD#</th>
                <th className={TH_CLASS}>Name</th>
                <th className={TH_CLASS}>Email</th>
                <th className={TH_CLASS}>SMS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {results.map((result, i) => {
                const guest = guestByOrder.get(result.chd_number);
                const email =
                  OUTCOME[channelOutcome("email", sendType, guest, result)];
                const sms =
                  OUTCOME[channelOutcome("sms", sendType, guest, result)];
                return (
                  <tr key={`r${i}`}>
                    <td className={TD_CLASS}>{result.chd_number}</td>
                    <td className={TD_CLASS}>{result.name}</td>
                    <td className={cn(TD_CLASS, email.className)}>
                      {email.label}
                    </td>
                    <td className={cn(TD_CLASS, sms.className)}>{sms.label}</td>
                  </tr>
                );
              })}
              {skipped.map((s, i) => (
                <tr key={`s${i}`} data-skipped>
                  <td className={TD_CLASS}>{s.chd_number || "—"}</td>
                  <td className={TD_CLASS}>{s.name}</td>
                  <td colSpan={2} className={cn(TD_CLASS, "text-stone-500")}>
                    Skipped: {s.message || s.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!sending ? (
        <div className="flex flex-wrap items-center gap-2">
          {batchId ? (
            <a
              href={sendBatchHref(batchId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-md bg-[#BA7517] px-4 py-2 text-sm font-medium text-white hover:bg-[#9a6010]"
            >
              📋 View this send
            </a>
          ) : null}
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
