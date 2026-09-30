import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";
import type { TicketsGuest, TicketsSendResult, TicketsSendType } from "@/types";

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
  skippedDuplicates,
  stop,
  onStartOver,
}: {
  sending: boolean;
  tourLabel: string;
  serviceDate: string;
  sendType: TicketsSendType;
  guests: TicketsGuest[];
  results: TicketsSendResult[];
  skippedDuplicates: number;
  stop: SendStop | null;
  onStartOver: () => void;
}) {
  const sent = results.filter(isGuestSent).length;
  const failed = results.length - sent;
  const uncertainCount = stop?.uncertain.length ?? 0;
  const notAttempted = stop
    ? guests.length - results.length - uncertainCount
    : 0;
  const notAttemptedGuests = stop
    ? guests.slice(results.length + uncertainCount)
    : [];

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
            aria-valuenow={results.length}
            className="h-2 overflow-hidden rounded-full bg-stone-100"
          >
            <div
              className="h-full bg-[#BA7517] transition-[width]"
              style={{
                width: `${guests.length ? (results.length / guests.length) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-sm text-stone-600 tabular-nums">
            {results.length} of {guests.length} done — keep this page open.
          </p>
        </div>
      ) : null}

      {stop ? (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-md border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-3 text-sm text-[#A32D2D]"
        >
          <p className="font-semibold">Sending stopped: {stop.reason}</p>
          {uncertainCount > 0 ? (
            <p>
              {uncertainCount} guest{uncertainCount === 1 ? "" : "s"} (
              {stop.uncertain.map((g) => g.chd_number).join(", ")}) may or may
              not have been sent. Check the Send Log before sending them again.
            </p>
          ) : null}
          {notAttempted > 0 ? (
            <p>
              {notAttempted} guest{notAttempted === 1 ? " was" : "s were"} not
              sent: {notAttemptedGuests.map((g) => g.chd_number).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Stat label="Sent" value={sent} className="text-[#BA7517]" />
        <Stat label="Failed" value={failed} className="text-[#A32D2D]" />
        <Stat
          label="Skipped (duplicates)"
          value={skippedDuplicates}
          className="text-stone-500"
        />
        <Stat
          label="To send"
          value={guests.length}
          className="text-stone-900"
        />
      </div>

      {results.length > 0 ? (
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
                const guest = guests[i];
                const email =
                  OUTCOME[channelOutcome("email", sendType, guest, result)];
                const sms =
                  OUTCOME[channelOutcome("sms", sendType, guest, result)];
                return (
                  <tr key={i}>
                    <td className={TD_CLASS}>{result.chd_number}</td>
                    <td className={TD_CLASS}>{result.name}</td>
                    <td className={cn(TD_CLASS, email.className)}>
                      {email.label}
                    </td>
                    <td className={cn(TD_CLASS, sms.className)}>{sms.label}</td>
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
