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
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
import { PhoneOneLine } from "@/components/ui/phone";
import { sendBatchHref } from "@/lib/send-log-api";
import {
  channelCell,
  countOutcomes,
  failedReason,
  outcomeStats,
} from "@/lib/send-outcome";
import { cn } from "@/lib/utils";
import type {
  TourGuest,
  TourLane,
  TourSendResult,
  TourSendType,
  TourSkipped,
} from "@/types";

import { LANES, sendTypeShort, tourRowOutcome } from "./config";

/** 中途停下：原因 + 状态不明的那一组（请求发出去了但没拿到结果）。 */
export interface TourSendStop {
  reason: string;
  uncertain: TourGuest[];
  /** 断开 / 超时 / 服务器出错：这一组可能已经在服务器上发出去了。 */
  maybeSent?: boolean;
}

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
  // 置顶 109：一位客人一个结论（Sent / Failed / No contact / Not sent），后端 outcome 优先。
  const rows = results.map((r) => ({ r, o: tourRowOutcome(r, sendType) }));
  const counts = countOutcomes(rows.map((x) => x.o.outcome));
  const uncertain = stop?.uncertain.length ?? 0;
  const notAttempted = stop ? guests.slice(processed + uncertain) : [];
  const noEmail = rows
    .filter((x) => x.o.email === "no_address")
    .map((x) => x.r);
  const noPhone = rows.filter((x) => x.o.sms === "no_address").map((x) => x.r);
  const link = batchId ? (
    <a
      href={sendBatchHref(batchId)}
      target="_blank"
      rel="noopener noreferrer"
      // 旧页面两块的 View this send 都是 .btn-send（绿）。
      className={sendButtonClass("green")}
    >
      📋 View this send
    </a>
  ) : null;

  return (
    <>
      <section
        aria-label={
          lane === "last_minute" ? "Last Minute results" : "Send results"
        }
        className={RESULT_CARD}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {lane === "last_minute" && !sending ? (
            <h2 className="mb-3 text-[13px] font-semibold text-[#7C4A00]">
              ⚡ Last Minute Send Complete
            </h2>
          ) : (
            <h2 className="mb-4 text-[15px] font-semibold text-[#1a1a1a]">
              {sending ? "Sending…" : "📬 Send Results"}
            </h2>
          )}
          <span className="text-[12px] text-[#1a1a1a]">
            {tourLabel} · {tourDate} · {sendTypeShort(sendType)}
          </span>
        </div>

        {sending ? (
          <SendProgress
            done={processed}
            total={guests.length}
            theme={LANES[lane].theme}
          >
            {processed} of {guests.length} done — keep this page open until the
            results appear.
          </SendProgress>
        ) : null}

        {stop ? (
          <div role="alert" className={cn(STOP_BOX, "mb-4")}>
            {stop.maybeSent ? (
              <>
                <p className="font-semibold">
                  ⛔ Stop. Do not send again. The page lost contact with the
                  server, and some or all messages may already have been sent.
                </p>
                <p>
                  {batchId ? "Click View this send" : "Open the Send Log"} to
                  see which messages went out. If something really went wrong,
                  wait a few minutes, then click Send Another and upload the
                  file again: orders already sent are skipped and never sent
                  twice.
                </p>
                <p className="text-[11px]">({stop.reason})</p>
              </>
            ) : (
              <p className="font-semibold">Sending stopped: {stop.reason}</p>
            )}
            {uncertain > 0 ? (
              <p>
                {uncertain} order{uncertain === 1 ? "" : "s"} (
                {stop.uncertain.map((g) => g.order_number).join(", ")}) may or
                may not have been sent.
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
            className="text-[#BA7517]"
          />
          <ResultStat label="Total" value={results.length + skipped.length} />
        </div>

        {results.length > 0 || skipped.length > 0 ? (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Order #</th>
                  <th className={TH}>Name</th>
                  <th className={TH}>Email Status</th>
                  <th className={TH}>SMS Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, o }, i) => {
                  const email = channelCell(
                    "email",
                    o.email,
                    failedReason(r.email_status),
                  );
                  const sms = channelCell(
                    "sms",
                    o.sms,
                    failedReason(r.sms_status),
                  );
                  return (
                    <tr key={`r${i}`} data-outcome={o.outcome} className={TR}>
                      <td className={TD}>{r.order}</td>
                      <td className={TD}>{r.name}</td>
                      <td className={cn(TD, email.className)}>{email.label}</td>
                      <td className={cn(TD, sms.className)}>{sms.label}</td>
                    </tr>
                  );
                })}
                {skipped.map((s, i) => (
                  <tr key={`s${i}`} data-skipped className={TR}>
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

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {link}
          {!sending ? (
            <button
              type="button"
              onClick={onStartOver}
              className={LIGHT_BUTTON}
            >
              ↩ Send Another
            </button>
          ) : null}
        </div>
      </section>

      {/* 旧页面的 Send Report 在结果卡下面（#skip-report）。 */}
      {noEmail.length || noPhone.length ? (
        <div className={cn(YELLOW_BOX, "-mt-2 mb-5")}>
          {/* 手机上压成一行 + More（手机版规则）；电脑上照旧一段一行。 */}
          <PhoneOneLine>
            <span className="font-semibold sm:block">
              ⚠️ Send Report - Skipped Items:{" "}
            </span>
            {noEmail.length ? (
              <span className="sm:block sm:pl-2">
                • Email skipped (no email):{" "}
                {noEmail.map((r) => r.order).join(", ")}{" "}
              </span>
            ) : null}
            {noPhone.length ? (
              <span className="sm:block sm:pl-2">
                • SMS skipped (no number):{" "}
                {noPhone.map((r) => r.order).join(", ")}
              </span>
            ) : null}
          </PhoneOneLine>
        </div>
      ) : null}
    </>
  );
}
