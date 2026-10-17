"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { Modal } from "@/components/ui/modal";
import {
  DUP_BADGE,
  INLINE_ERROR,
  LIGHT_BUTTON,
  PREVIEW_CARD,
  ResultStat,
  RESULT_CARD,
  RESULT_SUMMARY,
  RESULT_TITLE,
  SEND_ANYWAY_ALL,
  SEND_ANYWAY_LABEL,
  SendProgress,
  SendTypePicker,
  sendButtonClass,
  STOP_BOX,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
  previewHeaderClass,
} from "@/components/tickets-send/legacy-ui";
import { describeError } from "@/lib/api-errors";
import { previewFarmOutNotice, sendFarmOutNotice } from "@/lib/farm-out-api";
import { formatTime } from "@/lib/farm-out-time";
import { chunk, SEND_BATCH_SIZE } from "@/lib/send-batches";
import { cn } from "@/lib/utils";
import type { SeatingOrder } from "@/types";
import type {
  FarmOutNoticeBlocked,
  FarmOutNoticePreview,
  FarmOutNoticeResult,
  FarmOutNoticeSkipped,
} from "@/types/farm-out";

import { sentLabel, whenText } from "./farm-out-guests";

/** 渠道状态给 staff 看的写法：sent:<sid> → Sent；没发这个渠道 → —；失败 / 跳过保留后端的原因。 */
function statusText(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.startsWith("sent")) return "Sent";
  return s;
}
const isFailed = (s: string | null | undefined) => !!s && /fail/i.test(s);

type Channel = "combined" | "sms" | "email";
const TYPES = [
  { value: "combined", label: "SMS + Email" },
  { value: "sms", label: "SMS only" },
  { value: "email", label: "Email only" },
] as const;
const API_CHANNEL: Record<Channel, "both" | "sms" | "email"> = {
  combined: "both",
  sms: "sms",
  email: "email",
};

/**
 * 发转单通知的弹窗（G40）。格式照全站统一的发送页（`components/tickets-send/legacy-ui`，Annie 2026-10-12）：
 * 已发过的行淡黄 +「Sent by 谁 on 时间」、默认不勾，要重发勾 Send anyway；缺酒店的行红、不能勾；
 * 发送分小批（每批 10 单），某一批出错就停，写明哪些可能已发。
 */
export function FarmOutNoticeDialog({
  manifestId,
  tourName,
  date,
  orders,
  onClose,
  onDone,
}: {
  manifestId: number;
  tourName: string;
  date: string;
  orders: SeatingOrder[];
  onClose: () => void;
  /** 发过（哪怕只发了一部分）之后：重读 Seat guests。 */
  onDone: () => void;
}) {
  const titleId = useId();
  const list = useMemo(() => orders.filter((o) => o.order_number), [orders]);
  const [previews, setPreviews] = useState<
    Record<string, FarmOutNoticePreview>
  >({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [again, setAgain] = useState<Record<string, boolean>>({});
  const [channel, setChannel] = useState<Channel>("combined");
  const [phase, setPhase] = useState<"pick" | "sending" | "done">("pick");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<FarmOutNoticeResult[]>([]);
  // 后端说没发的：缺资料 / 短信超长（blocked）、已发过又没勾 Send anyway（skipped_sent）。
  const [blocked, setBlocked] = useState<FarmOutNoticeBlocked[]>([]);
  const [skippedSent, setSkippedSent] = useState<FarmOutNoticeSkipped[]>([]);
  const [counts, setCounts] = useState({ sent: 0, failed: 0 });
  const [stop, setStop] = useState<{
    maybe: string[];
    notSent: string[];
    text: string;
  } | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    previewFarmOutNotice(
      date,
      list.map((o) => ({
        manifest_id: manifestId,
        order_number: o.order_number as string,
      })),
    ).then(
      (ps) => {
        if (!live) return;
        setPreviews(Object.fromEntries(ps.map((p) => [p.order_number, p])));
      },
      (e) => live && setLoadErr(describeError(e)),
    );
    return () => {
      live = false;
    };
  }, [list]);

  // 默认勾上：没发过、不缺东西的单。
  useEffect(() => {
    setPicked((cur) => {
      const next = { ...cur };
      for (const o of list) {
        const k = o.order_number as string;
        if (k in next) continue;
        next[k] = !o.farm_out?.notice_sent_at && !previews[k]?.missing.length;
      }
      return next;
    });
  }, [list, previews]);

  const missingOf = (o: SeatingOrder): string[] => {
    const k = o.order_number as string;
    // 后端写的是缺什么（"pick-up location" / "departure time (…)"），这里补一个 Missing。
    const m = (previews[k]?.missing ?? []).map((x) => `Missing ${x}`);
    if (o.farm_out && o.farm_out.partner_location_id == null && !m.length)
      return ["Missing hotel"];
    return m;
  };
  // 发没发过：seating 里的 notice_sent_at，或 send_log（preview 的 already_sent，重新转单后也还在）。
  const isSent = (o: SeatingOrder) =>
    !!o.farm_out?.notice_sent_at ||
    !!previews[o.order_number as string]?.already_sent;
  const sentText = (o: SeatingOrder): string | null => {
    const l = sentLabel(o);
    if (l) return l.replace("Notice sent", "Sent");
    const a = previews[o.order_number as string]?.already_sent;
    return a
      ? `Sent${a.sent_by ? ` by ${a.sent_by}` : ""} on ${whenText(a.sent_at)}`
      : null;
  };
  const willSend = list.filter((o) => {
    const k = o.order_number as string;
    return picked[k] && !missingOf(o).length && (!isSent(o) || again[k]);
  });
  const sentRows = list.filter(isSent);
  const first = willSend[0] ?? list[0];
  const preview = first ? previews[first.order_number as string] : undefined;

  async function send() {
    const nums = willSend.map((o) => o.order_number as string);
    if (!nums.length) return;
    setPhase("sending");
    setProgress(0);
    setResults([]);
    setBlocked([]);
    setSkippedSent([]);
    setCounts({ sent: 0, failed: 0 });
    setStop(null);
    const batches = chunk(nums, SEND_BATCH_SIZE);
    const all: FarmOutNoticeResult[] = [];
    const allBlocked: FarmOutNoticeBlocked[] = [];
    const allSkipped: FarmOutNoticeSkipped[] = [];
    let sentN = 0;
    let failedN = 0;
    for (let i = 0; i < batches.length; i++) {
      try {
        const r = await sendFarmOutNotice(
          date,
          batches[i].map((n) => ({ manifest_id: manifestId, order_number: n })),
          API_CHANNEL[channel],
          batches[i].filter((n) => again[n]),
        );
        all.push(...r.results);
        allBlocked.push(...(r.blocked ?? []));
        allSkipped.push(...(r.skipped_sent ?? []));
        sentN += r.sent;
        failedN += r.failed;
        setResults([...all]);
        setBlocked([...allBlocked]);
        setSkippedSent([...allSkipped]);
        setCounts({ sent: sentN, failed: failedN });
        setProgress(all.length + allBlocked.length + allSkipped.length);
      } catch (e) {
        setStop({
          maybe: batches[i],
          notSent: batches.slice(i + 1).flat(),
          text: describeError(e),
        });
        break;
      }
    }
    setPhase("done");
    onDone();
  }

  const nameOf = (n: string) =>
    list.find((o) => o.order_number === n)?.name || "";
  const notSentCount = blocked.length + skippedSent.length;
  const logFailed = results.filter((r) => r.log_failed);

  return (
    <Modal
      titleId={titleId}
      onDismiss={phase === "sending" ? undefined : onClose}
      panelClassName="max-w-[1080px] p-5 max-h-[92vh] overflow-y-auto"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id={titleId}
          className="m-0 text-[15px] font-semibold text-[#1a1a1a]"
        >
          Farm out notice · {tourName} · {date}
        </h2>
        {phase !== "sending" ? (
          <button type="button" onClick={onClose} className={LIGHT_BUTTON}>
            {phase === "done" ? "Close" : "Cancel"}
          </button>
        ) : null}
      </div>
      {loadErr ? (
        <p role="alert" className="text-[12.5px] text-[#b3261e]">
          {loadErr}
        </p>
      ) : null}
      {phase === "pick" ? (
        <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <SendTypePicker
              types={TYPES}
              value={channel}
              onChange={setChannel}
            />
            <div className={PREVIEW_CARD}>
              <div
                className={cn(
                  previewHeaderClass("blue"),
                  "text-[13px] text-[#1a1a1a]",
                )}
              >
                <b>Guests on the farm out vehicle</b>
                <span className="text-[12px]">
                  {willSend.length} to send · {sentRows.length} already sent
                </span>
              </div>
              <div className={TABLE_WRAP}>
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={
                            willSend.length > 0 &&
                            list.every(
                              (o) =>
                                missingOf(o).length ||
                                isSent(o) ||
                                picked[o.order_number as string],
                            )
                          }
                          onChange={(e) =>
                            setPicked(
                              Object.fromEntries(
                                list.map((o) => [
                                  o.order_number as string,
                                  e.target.checked &&
                                    !missingOf(o).length &&
                                    !isSent(o),
                                ]),
                              ),
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
                        <span className={SEND_ANYWAY_ALL}>Send anyway</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {list.map((o) => {
                      const k = o.order_number as string;
                      const miss = missingOf(o);
                      const sent = isSent(o);
                      const f = o.farm_out;
                      return (
                        <tr
                          key={k}
                          data-notice-row={k}
                          className={cn(
                            TR,
                            sent && "bg-[#fff8e1]",
                            miss.length && "bg-[#fdecec]",
                          )}
                          onMouseEnter={() => setShown(k)}
                        >
                          <td className={TD}>
                            <input
                              type="checkbox"
                              aria-label={`Send to ${o.name || k}`}
                              disabled={!!miss.length || (sent && !again[k])}
                              checked={
                                !miss.length &&
                                (sent ? !!again[k] : !!picked[k])
                              }
                              onChange={(e) =>
                                setPicked((p) => ({
                                  ...p,
                                  [k]: e.target.checked,
                                }))
                              }
                            />
                          </td>
                          <td className={TD}>{k}</td>
                          <td className={TD}>{o.ota_conf_number ?? k}</td>
                          <td className={TD}>
                            {o.name || "—"}
                            {sent ? (
                              <>
                                <br />
                                <span
                                  className={cn(DUP_BADGE, "whitespace-normal")}
                                >
                                  {sentText(o)}
                                </span>
                              </>
                            ) : null}
                          </td>
                          <td
                            className={cn(TD, miss.length && "text-[#A32D2D]")}
                          >
                            {miss.length ? miss.join("; ") : "OK"}
                          </td>
                          <td className={TD}>
                            {f?.checkin_time && f.depart_time
                              ? `${formatTime(f.checkin_time)} / ${formatTime(f.depart_time)}`
                              : "—"}
                          </td>
                          <td className={TD}>
                            {sent ? (
                              <label className={SEND_ANYWAY_LABEL}>
                                <input
                                  type="checkbox"
                                  checked={!!again[k]}
                                  onChange={(e) => {
                                    setAgain((a) => ({
                                      ...a,
                                      [k]: e.target.checked,
                                    }));
                                    setPicked((p) => ({
                                      ...p,
                                      [k]: e.target.checked,
                                    }));
                                  }}
                                />
                                Send anyway
                              </label>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t-[0.5px] border-black/[.08] px-4 py-3">
                <button
                  type="button"
                  data-farm-out-send-go
                  disabled={!willSend.length}
                  onClick={() => void send()}
                  className={sendButtonClass("blue")}
                >
                  Send {willSend.length}{" "}
                  {willSend.length === 1 ? "notice" : "notices"} (
                  {TYPES.find((t) => t.value === channel)?.label})
                </button>
                {!willSend.length ? (
                  <span className={INLINE_ERROR}>
                    Nothing to send: tick a guest first.
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <aside className="min-w-0 rounded-xl border-[0.5px] border-black/10 bg-paper">
            <div className="border-b-[0.5px] border-black/[.08] px-4 py-3 text-[13px] font-semibold text-[#1a1a1a]">
              Preview ·{" "}
              {(shown && list.find((o) => o.order_number === shown)?.name) ||
                first?.name ||
                "—"}
            </div>
            {(() => {
              const p = (shown && previews[shown]) || preview || undefined;
              return p ? (
                <>
                  <p className="m-0 px-4 pt-3 text-[11.5px] font-semibold text-[#1a1a1a]">
                    {channel === "sms"
                      ? "SMS"
                      : `Subject: ${p.channel_text.email_subject}`}
                  </p>
                  <pre
                    data-notice-preview
                    className="m-0 px-4 py-3 font-[inherit] text-[12px] leading-[1.6] whitespace-pre-wrap text-[#1a1a1a]"
                  >
                    {channel === "sms"
                      ? p.channel_text.sms_body
                      : p.channel_text.email_body}
                  </pre>
                </>
              ) : (
                <p className="m-0 px-4 py-3 text-[12px] text-[#1a1a1a]">
                  Loading…
                </p>
              );
            })()}
          </aside>
        </div>
      ) : (
        <div className={RESULT_CARD}>
          <div className={RESULT_TITLE}>
            {phase === "sending" ? "Sending…" : "Send results"}
          </div>
          <SendProgress done={progress} total={willSend.length} theme="blue">
            {progress} of {willSend.length} done
          </SendProgress>
          {stop ? (
            <div className={STOP_BOX} role="alert">
              Stopped: {stop.text}. These may or may not have been sent — check
              Send Log first: {stop.maybe.join(", ")}.
              {stop.notSent.length
                ? ` Not sent: ${stop.notSent.join(", ")}.`
                : ""}
            </div>
          ) : null}
          {logFailed.length ? (
            <div className={STOP_BOX} role="alert">
              Sent, but the Send Log could not record it:{" "}
              {logFailed.map((r) => r.order_number).join(", ")}. Check Send Log
              before sending these again.
            </div>
          ) : null}
          {phase === "done" ? (
            <div className={RESULT_SUMMARY}>
              <ResultStat
                label="Sent"
                value={counts.sent}
                className="text-[#BA7517]"
              />
              <ResultStat
                label="Failed"
                value={counts.failed}
                className="text-[#A32D2D]"
              />
              <ResultStat
                label="Not sent"
                value={notSentCount}
                className="text-[#A32D2D]"
              />
              <ResultStat label="Total" value={results.length + notSentCount} />
            </div>
          ) : null}
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
                {results.map((r) => (
                  <tr key={r.order_number} className={TR}>
                    <td className={TD}>{r.order_number}</td>
                    <td className={TD}>{r.name}</td>
                    {[r.email_status, r.sms_status].map((s, i) => (
                      <td
                        key={i}
                        className={cn(
                          TD,
                          isFailed(s)
                            ? "text-[#A32D2D]"
                            : "font-medium text-[#BA7517]",
                        )}
                      >
                        {statusText(s)}
                      </td>
                    ))}
                  </tr>
                ))}
                {blocked.map((b) => (
                  <tr
                    key={`b-${b.order_number}`}
                    className={TR}
                    data-blocked-row={b.order_number}
                  >
                    <td className={TD}>{b.order_number}</td>
                    <td className={TD}>{nameOf(b.order_number) || "—"}</td>
                    <td className={cn(TD, "text-[#A32D2D]")} colSpan={2}>
                      Not sent: {b.missing.join("; ")}
                    </td>
                  </tr>
                ))}
                {skippedSent.map((s) => (
                  <tr
                    key={`s-${s.order_number}`}
                    className={TR}
                    data-skipped-row={s.order_number}
                  >
                    <td className={TD}>{s.order_number}</td>
                    <td className={TD}>{nameOf(s.order_number) || "—"}</td>
                    <td className={cn(TD, "text-[#A32D2D]")} colSpan={2}>
                      Not sent: already sent
                      {s.sent_by ? ` by ${s.sent_by}` : ""} on{" "}
                      {whenText(s.sent_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
