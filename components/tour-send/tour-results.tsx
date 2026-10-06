import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { sendBatchHref } from "@/lib/send-log-api";
import { cn } from "@/lib/utils";
import type {
  TourGuest,
  TourLane,
  TourSendResult,
  TourSendType,
  TourSkipped,
} from "@/types";

import {
  channelStatus,
  isResultNoAddress,
  isResultSent,
  LANES,
  type StatusTone,
  sendTypeShort,
} from "./config";

/** 中途停下：原因 + 状态不明的那一组（请求发出去了但没拿到结果）。 */
export interface TourSendStop {
  reason: string;
  uncertain: TourGuest[];
  /** 断开 / 超时 / 服务器出错：这一组可能已经在服务器上发出去了。 */
  maybeSent?: boolean;
}

const TONE: Record<StatusTone, string> = {
  sent: "font-medium text-[#1a6b3c]",
  failed: "font-medium text-[#A32D2D]",
  "no-address": "text-[#BA7517]",
  none: "text-stone-300",
};

const TH =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-500";
const TD = "px-3 py-2 whitespace-nowrap";

export function TourResults({
  lane,
  sending,
  tourLabel,
  tourDate,
  sendType,
  guests,
  results,
  skipped,
  processed,
  stop,
  batchId,
  onStartOver,
}: {
  lane: TourLane;
  sending: boolean;
  tourLabel: string;
  tourDate: string;
  sendType: TourSendType;
  guests: TourGuest[];
  results: TourSendResult[];
  skipped: TourSkipped[];
  processed: number;
  stop: TourSendStop | null;
  batchId: number | null;
  onStartOver: () => void;
}) {
  const sent = results.filter(isResultSent).length;
  // 没发出去、也没有哪条渠道真失败（只是没邮箱 / 没手机号）：单独算 No address，不算失败。
  const noAddress = results.filter(isResultNoAddress).length;
  const uncertain = stop?.uncertain.length ?? 0;
  const notAttempted = stop ? guests.slice(processed + uncertain) : [];
  const noEmail = results.filter(
    (r) => r.email_status === "skipped - no email",
  );
  const noPhone = results.filter((r) => r.sms_status === "skipped - no phone");
  const link = batchId ? (
    <a
      href={sendBatchHref(batchId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex rounded-md bg-[#3B6D11] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d5409]"
    >
      📋 View this send
    </a>
  ) : null;

  return (
    <section
      aria-label={
        lane === "last_minute" ? "Last Minute results" : "Send results"
      }
      className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={cn("text-base font-semibold", LANES[lane].headText)}>
          {sending
            ? "Sending…"
            : lane === "last_minute"
              ? "⚡ Last Minute Send Complete"
              : "📬 Send Results"}
        </h2>
        <span className="text-xs text-stone-500">
          {tourLabel} · {tourDate} · {sendTypeShort(sendType)}
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
              className="h-full bg-[#3B6D11] transition-[width]"
              style={{
                width: `${guests.length ? (processed / guests.length) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-sm text-stone-600 tabular-nums">
            {processed} of {guests.length} done — keep this page open until the
            results appear.
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
                ⛔ Stop. Do not send again. The page lost contact with the
                server, and some or all messages may already have been sent.
              </p>
              <p>
                {batchId ? "Click View this send" : "Open the Send Log"} to see
                which messages went out. If something really went wrong, wait a
                few minutes, then click Send Another and upload the file again:
                orders already sent are skipped and never sent twice.
              </p>
              <p className="text-xs">({stop.reason})</p>
            </>
          ) : (
            <p className="font-semibold">Sending stopped: {stop.reason}</p>
          )}
          {uncertain > 0 ? (
            <p>
              {uncertain} order{uncertain === 1 ? "" : "s"} (
              {stop.uncertain.map((g) => g.order_number).join(", ")}) may or may
              not have been sent.
            </p>
          ) : null}
          {notAttempted.length > 0 ? (
            <p>
              {notAttempted.length} order
              {notAttempted.length === 1 ? " was" : "s were"} not sent:{" "}
              {notAttempted.map((g) => g.order_number).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Stat label="Sent" value={sent} className="text-[#3B6D11]" />
        <Stat
          label="Failed"
          value={results.length - sent - noAddress}
          className="text-[#A32D2D]"
        />
        <Stat label="No address" value={noAddress} className="text-[#BA7517]" />
        <Stat
          label="Skipped"
          value={skipped.length}
          className="text-[#BA7517]"
        />
        <Stat
          label="Total"
          value={results.length + skipped.length}
          className="text-stone-900"
        />
      </div>

      {results.length > 0 || skipped.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={TH}>Order #</th>
                <th className={TH}>Name</th>
                <th className={TH}>Email</th>
                <th className={TH}>SMS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {results.map((r, i) => {
                const email = channelStatus(r.email_status);
                const sms = channelStatus(r.sms_status);
                return (
                  <tr key={`r${i}`}>
                    <td className={TD}>{r.order}</td>
                    <td className={TD}>{r.name}</td>
                    <td className={cn(TD, TONE[email.tone])}>{email.text}</td>
                    <td className={cn(TD, TONE[sms.tone])}>{sms.text}</td>
                  </tr>
                );
              })}
              {skipped.map((s, i) => (
                <tr key={`s${i}`} data-skipped>
                  <td className={TD}>{s.order || s.order_number || "—"}</td>
                  <td className={TD}>{s.name}</td>
                  <td colSpan={2} className={cn(TD, "text-[#BA7517]")}>
                    Skipped: {s.message || s.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {noEmail.length || noPhone.length ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">⚠️ Send Report - Skipped Items:</p>
          {noEmail.length ? (
            <p className="pl-4">
              • Email skipped (no email address):{" "}
              {noEmail.map((r) => r.order).join(", ")}
            </p>
          ) : null}
          {noPhone.length ? (
            <p className="pl-4">
              • SMS skipped (no phone number):{" "}
              {noPhone.map((r) => r.order).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {link}
        {!sending ? (
          <button
            type="button"
            onClick={onStartOver}
            className={SECONDARY_BUTTON_CLASS}
          >
            ↩ Send Another
          </button>
        ) : null}
      </div>
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
