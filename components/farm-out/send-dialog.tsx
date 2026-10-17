"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/modal";
import {
  DUP_BADGE,
  PREVIEW_CARD,
  previewHeaderClass,
  ResultStat,
  RESULT_CARD,
  RESULT_SUMMARY,
  RESULT_TITLE,
  SEND_ANYWAY_ALL,
  SEND_ANYWAY_LABEL,
  sendButtonClass,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
} from "@/components/tickets-send/legacy-ui";
import { describeError } from "@/lib/api-errors";
import {
  fetchFarmOutSendPreview,
  sendFarmOutNotice,
} from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type { FarmOutSendPreview, FarmOutSendResult } from "@/types";

/**
 * 发 Farm out 转单通知（任务包第 12–17 条）：统一发送格式（components/tickets-send/legacy-ui），
 * 已发过的行淡黄 + 「Sent by 谁 on 时间」、默认不勾，要重发勾 Send anyway；没选酒店的灰勾、不能发。
 * 走短信和邮件两个渠道（不像别的发送页能单选），一次都发。
 */
export function FarmOutSendDialog({
  date,
  manifestId,
  tourName,
  partnerName,
  onClose,
  onSent,
}: {
  date: string;
  manifestId: number;
  tourName: string;
  partnerName: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [preview, setPreview] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: FarmOutSendPreview }
  >({ kind: "loading" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sendAnyway, setSendAnyway] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<FarmOutSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchFarmOutSendPreview(date, manifestId)
      .then((data) => {
        if (!live) return;
        setPreview({ kind: "ready", data });
        setChecked(
          new Set(
            data.rows
              .filter((r) => !r.already_sent && !r.missing_pickup_spot)
              .map((r) => r.order_number),
          ),
        );
      })
      .catch((e) => live && setPreview({ kind: "error", message: describeError(e) }));
    return () => {
      live = false;
    };
  }, [date, manifestId]);

  const data = preview.kind === "ready" ? preview.data : null;
  const sendable = (data?.rows ?? []).filter((r) => !r.missing_pickup_spot);
  const toSend = sendable.filter(
    (r) => checked.has(r.order_number) || sendAnyway.has(r.order_number),
  );

  async function submit() {
    if (!data || !toSend.length) return;
    setSending(true);
    setError(null);
    try {
      const r = await sendFarmOutNotice(
        date,
        manifestId,
        toSend.map((row) => row.order_number),
        [...sendAnyway],
      );
      setResult(r);
      onSent();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      titleId="farm-out-send-title"
      onDismiss={sending ? undefined : onClose}
      panelClassName="w-full max-w-[1040px] max-h-[88vh] overflow-y-auto rounded-xl bg-paper p-5"
    >
      <h2 id="farm-out-send-title" className="sr-only">
        Send farm out notice — {tourName}
      </h2>
      {preview.kind === "loading" ? (
        <p className="m-0 p-4 text-[13px] text-[#1a1a1a]">Loading…</p>
      ) : preview.kind === "error" ? (
        <p role="alert" className="m-0 p-4 text-[13px] text-[#A32D2D]">
          Could not load the notice: {preview.message}
        </p>
      ) : result ? (
        <SendResults
          result={result}
          tourName={tourName}
          onClose={onClose}
        />
      ) : (
        <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className={PREVIEW_CARD}>
              <div className={previewHeaderClass("slate")}>
                <b className="text-[13px] text-[#1a1a1a]">
                  Farm out notice · {tourName} ·{" "}
                  {new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </b>
                <span className="text-[12px] text-[#1a1a1a]">
                  {toSend.length} to send ·{" "}
                  {data!.rows.filter((r) => r.already_sent).length} already
                  sent
                </span>
              </div>
              <div className={TABLE_WRAP}>
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>
                        <input
                          type="checkbox"
                          aria-label="all"
                          checked={
                            sendable.length > 0 &&
                            sendable.every(
                              (r) =>
                                checked.has(r.order_number) ||
                                sendAnyway.has(r.order_number),
                            )
                          }
                          onChange={(e) =>
                            setChecked(
                              e.target.checked
                                ? new Set(
                                    sendable
                                      .filter((r) => !r.already_sent)
                                      .map((r) => r.order_number),
                                  )
                                : new Set(),
                            )
                          }
                        />
                      </th>
                      <th className={TH}>CHD#</th>
                      <th className={TH}>Confirmation#</th>
                      <th className={TH}>Name</th>
                      <th className={TH}>Hotel</th>
                      <th className={TH}>Check-in / Departs</th>
                      <th className={TH}>
                        <label className={SEND_ANYWAY_ALL}>
                          <input
                            type="checkbox"
                            checked={
                              sendable.filter((r) => r.already_sent).length >
                                0 &&
                              sendable
                                .filter((r) => r.already_sent)
                                .every((r) => sendAnyway.has(r.order_number))
                            }
                            onChange={(e) =>
                              setSendAnyway(
                                e.target.checked
                                  ? new Set(
                                      sendable
                                        .filter((r) => r.already_sent)
                                        .map((r) => r.order_number),
                                    )
                                  : new Set(),
                              )
                            }
                          />
                          Send anyway (all)
                        </label>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.rows.map((r) => (
                      <tr
                        key={r.order_number}
                        className={cn(
                          TR,
                          r.already_sent && "bg-[#fff8e1]",
                          r.missing_pickup_spot && "bg-[#fdecec]",
                        )}
                      >
                        <td className={TD}>
                          <input
                            type="checkbox"
                            aria-label="row"
                            disabled={r.missing_pickup_spot}
                            checked={
                              checked.has(r.order_number) ||
                              sendAnyway.has(r.order_number)
                            }
                            onChange={(e) =>
                              setChecked((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked)
                                  next.add(r.order_number);
                                else next.delete(r.order_number);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className={TD}>{r.chd_number}</td>
                        <td className={TD}>{r.confirmation}</td>
                        <td className={TD}>
                          {r.name}
                          {r.already_sent ? (
                            <span className={cn(DUP_BADGE, "ml-1 block w-fit")}>
                              Sent by {r.already_sent.by} on{" "}
                              {new Date(r.already_sent.at).toLocaleString(
                                "en-US",
                                { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
                              )}
                            </span>
                          ) : null}
                        </td>
                        <td
                          className={cn(
                            TD,
                            r.missing_pickup_spot && "text-[#A32D2D]",
                          )}
                        >
                          {r.pickup_spot_name ?? "Missing hotel"}
                        </td>
                        <td className={TD}>
                          {r.checkin_time && r.depart_time
                            ? `${r.checkin_time} / ${r.depart_time}`
                            : "—"}
                        </td>
                        <td className={TD}>
                          {r.already_sent ? (
                            <label className={SEND_ANYWAY_LABEL}>
                              <input
                                type="checkbox"
                                checked={sendAnyway.has(r.order_number)}
                                onChange={(e) =>
                                  setSendAnyway((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked)
                                      next.add(r.order_number);
                                    else next.delete(r.order_number);
                                    return next;
                                  })
                                }
                              />
                              Send anyway
                            </label>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t-[0.5px] border-black/[.08] px-4 py-3">
                {error ? (
                  <span role="alert" className="text-[12px] text-[#A32D2D]">
                    {error}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={sending || !toSend.length}
                  onClick={() => void submit()}
                  className={sendButtonClass("slate")}
                >
                  {sending
                    ? "Sending…"
                    : `Send ${toSend.length} notice${toSend.length === 1 ? "" : "s"} (SMS + email)`}
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={onClose}
                  className="h-9 rounded-[10px] border-[0.5px] border-black/20 bg-paper px-3.5 text-[13px] font-[650] text-[#1a1a1a]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
          <aside className="min-w-0 rounded-xl border-[0.5px] border-black/10 bg-paper">
            <div className="border-b-[0.5px] border-black/[.08] px-4 py-3 text-[13px] font-semibold text-[#1a1a1a]">
              Preview · {data!.rows[0]?.name ?? "sample"} (SMS &amp; email)
            </div>
            <div className="px-4 py-3 text-[12px] text-[#1a1a1a]">
              <p className="m-0 mb-2 font-semibold">
                Subject: {data!.sample_email_subject}
              </p>
              <pre className="m-0 mb-3 leading-[1.6] whitespace-pre-wrap font-sans">
                {data!.sample_email_body}
              </pre>
              <p className="m-0 mb-1 font-semibold">SMS</p>
              <pre className="m-0 leading-[1.6] whitespace-pre-wrap font-sans">
                {data!.sample_sms}
              </pre>
            </div>
            <p className="m-0 border-t-[0.5px] border-black/[.08] px-4 py-2.5 text-[11.5px] text-[#1a1a1a]">
              The notice never names {partnerName}.
            </p>
          </aside>
        </div>
      )}
    </Modal>
  );
}

function SendResults({
  result,
  tourName,
  onClose,
}: {
  result: FarmOutSendResult;
  tourName: string;
  onClose: () => void;
}) {
  return (
    <div className={RESULT_CARD}>
      <div className={RESULT_TITLE}>Send results · {tourName}</div>
      <div className={RESULT_SUMMARY}>
        <ResultStat
          label="Sent"
          value={result.sent}
          className="text-[#BA7517]"
        />
        <ResultStat
          label="Failed"
          value={result.failed}
          className="text-[#A32D2D]"
        />
        <ResultStat label="Total" value={result.total} />
      </div>
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
            {result.rows.map((r) => (
              <tr key={r.order_number} className={TR}>
                <td className={TD}>{r.chd_number}</td>
                <td className={TD}>{r.name}</td>
                <td
                  className={cn(
                    TD,
                    "font-medium",
                    r.email_status === "sent"
                      ? "text-[#BA7517]"
                      : r.email_status === "failed"
                        ? "text-[#A32D2D]"
                        : "text-[#1a1a1a]",
                  )}
                >
                  {r.email_status === "sent"
                    ? "Sent"
                    : r.email_status === "failed"
                      ? `Failed: ${r.email_error ?? "unknown error"}`
                      : "Skipped"}
                </td>
                <td
                  className={cn(
                    TD,
                    "font-medium",
                    r.sms_status === "sent"
                      ? "text-[#BA7517]"
                      : r.sms_status === "failed"
                        ? "text-[#A32D2D]"
                        : "text-[#1a1a1a]",
                  )}
                >
                  {r.sms_status === "sent"
                    ? "Sent"
                    : r.sms_status === "failed"
                      ? `Failed: ${r.sms_error ?? "unknown error"}`
                      : "Skipped"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-[10px] border-[0.5px] border-black/20 bg-paper px-3.5 text-[13px] font-[650] text-[#1a1a1a]"
        >
          Close
        </button>
      </div>
    </div>
  );
}
