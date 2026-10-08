"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { fetchSendBatch, fetchSendBatches } from "@/lib/send-log-api";
import { cn } from "@/lib/utils";
import type {
  SendBatch,
  SendBatchDelivery,
  SendBatchDetail,
  SendBatchSummary,
} from "@/types";

import { emailStatus, smsStatus, type StatusPill, TONE_CLASS } from "./config";

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; batches: SendBatch[] };

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: SendBatchDetail };

/** 地址栏 ?batch=<id>（发送页的 View this send 带过来）。 */
export function batchFromUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get("batch");
  return v && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null;
}

/**
 * Send Log 顶部「📦 Send batches」：一次点 Send 一批（门票、团确认、Last Minute），新的在前，默认收起
 * （同旧页面，待办 G23）。带 ?batch= 打开时那一批展开并滚到它；不在所选日期里也单独取来放最上面。
 */
export function SendBatches({
  from,
  to,
  target,
  onUnauthorized,
}: {
  from: string;
  to: string;
  target: number | null;
  onUnauthorized: () => void;
}) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(target ? [target] : []),
  );
  const [details, setDetails] = useState<Record<number, DetailState>>({});
  const scrolledRef = useRef(false);

  /** 每一批最近一次取明细的序号：连点 ↻ Refresh 时只认最后一次的结果。 */
  const detailSeqRef = useRef<Map<number, number>>(new Map());

  const loadDetail = useCallback(
    async (id: number) => {
      const seq = (detailSeqRef.current.get(id) ?? 0) + 1;
      detailSeqRef.current.set(id, seq);
      const current = () => detailSeqRef.current.get(id) === seq;
      setDetails((d) => ({ ...d, [id]: { kind: "loading" } }));
      try {
        const detail = await fetchSendBatch(id);
        if (!current()) return;
        setDetails((d) => ({ ...d, [id]: { kind: "ready", detail } }));
      } catch (error) {
        if (!current()) return;
        if (isStatus(error, 401)) onUnauthorized();
        else
          setDetails((d) => ({
            ...d,
            [id]: { kind: "error", message: describeError(error) },
          }));
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    if (!from) return;
    const controller = new AbortController();
    setList({ kind: "loading" });
    (async () => {
      try {
        let batches = await fetchSendBatches(from, to, controller.signal);
        // 从发送页跳过来、而那一批不在这个日期范围里（比如半夜跨天）：单独取来放最上面。
        if (target && !batches.some((b) => b.id === target)) {
          try {
            const one = await fetchSendBatch(target, controller.signal);
            batches = [one, ...batches];
            setDetails((d) => ({
              ...d,
              [target]: { kind: "ready", detail: one },
            }));
          } catch {
            // 取不到（不存在 / 没权限）就算了，列表照常显示。
          }
        }
        if (!controller.signal.aborted) setList({ kind: "ready", batches });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setList({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [from, to, target, onUnauthorized]);

  // ?batch= 是挂载后才从地址栏读到的：读到就把那一批展开。
  useEffect(() => {
    if (target) setOpen((s) => (s.has(target) ? s : new Set(s).add(target)));
  }, [target]);

  // 打开着的批次（含 ?batch= 那一批）：没取过明细就取。
  useEffect(() => {
    if (list.kind !== "ready") return;
    for (const b of list.batches)
      if (open.has(b.id) && !details[b.id]) void loadDetail(b.id);
  }, [list, open, details, loadDetail]);

  // ?batch= 那一批：滚过去一次。
  useEffect(() => {
    if (!target || scrolledRef.current || list.kind !== "ready") return;
    const el = document.querySelector(`[data-batch="${target}"]`);
    if (el) {
      scrolledRef.current = true;
      el.scrollIntoView({ block: "start" });
    }
  }, [list, target]);

  function toggle(id: number) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      aria-label="Send batches"
      className="mb-[18px] overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white"
    >
      <div className="flex items-center gap-2 border-b-[0.5px] border-black/[.08] bg-[#FAEEDA] px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-[#7C4A00]">
          📦 Send batches
        </h2>
        <span className="text-[11px] font-normal text-[#9a6a2a]">
          One block per click on Send in Tickets Reminder or Tour Confirmation.
          Click a block to open it.
        </span>
      </div>
      {list.kind === "loading" ? (
        <p className="px-4 py-3.5 text-[12px] text-[#aaa]">Loading…</p>
      ) : list.kind === "error" ? (
        <p role="alert" className="px-4 py-3.5 text-[12px] text-[#A32D2D]">
          Failed to load the send batches: {list.message}
        </p>
      ) : list.batches.length === 0 ? (
        <p className="px-4 py-3.5 text-[12px] text-[#aaa]">
          No send batches for these dates.
        </p>
      ) : (
        <ul>
          {list.batches.map((b) => {
            const isOpen = open.has(b.id);
            const d = details[b.id];
            const summary = d?.kind === "ready" ? d.detail.summary : b.summary;
            return (
              <li
                key={b.id}
                data-batch={b.id}
                className="border-b-[0.5px] border-black/[.08] last:border-b-0"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(b.id)}
                  className={cn(
                    "flex w-full cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2.5 text-left text-[12.5px] text-[#333]",
                    isOpen ? "bg-[#fffaf0]" : "hover:bg-[#fafaf8]",
                    b.id === target && "shadow-[inset_3px_0_0_#BA7517]",
                  )}
                >
                  <span className="font-bold text-[#1a1a1a]">
                    Sent at {b.started_at}
                  </span>
                  <span className="text-[#666]">
                    {b.tour_label || b.tour_type} · Tour date{" "}
                    {b.tour_date || "—"} · by {b.sent_by || "—"}
                  </span>
                  <Chips s={summary} />
                </button>
                {isOpen ? (
                  <div className="bg-[#fffdf8] px-4 pt-3 pb-4">
                    {!d || d.kind === "loading" ? (
                      <p className="text-[12px] text-[#aaa]">Loading…</p>
                    ) : d.kind === "error" ? (
                      <p role="alert" className="text-[12px] text-[#A32D2D]">
                        Failed to load this send: {d.message}{" "}
                        <button
                          type="button"
                          onClick={() => void loadDetail(b.id)}
                          className="underline"
                        >
                          Retry
                        </button>
                      </p>
                    ) : (
                      <BatchDetail
                        b={d.detail}
                        onRefresh={() => void loadDetail(b.id)}
                      />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 旧页面 .chip。 */
const CHIP = "rounded-[10px] px-2 py-px text-[11px] font-semibold";

function Chips({ s }: { s: SendBatchSummary }) {
  return (
    <span className="flex flex-wrap gap-1" data-chips>
      <span className={cn(CHIP, "bg-[#EAF3DE] text-[#3B6D11]")}>
        Sent {s.sent}
      </span>
      {s.failed ? (
        <span className={cn(CHIP, "bg-[#FCEBEB] text-[#A32D2D]")}>
          Failed {s.failed}
        </span>
      ) : null}
      {s.skipped ? (
        <span className={cn(CHIP, "bg-[#f1efe8] text-[#5f5e5a]")}>
          Skipped {s.skipped}
        </span>
      ) : null}
      {s.not_sent ? (
        <span className={cn(CHIP, "bg-[#E6F1FB] text-[#185FA5]")}>
          Not sent {s.not_sent}
        </span>
      ) : null}
    </span>
  );
}

function deliveryLine(c: SendBatchDelivery, label: string): string {
  return c.delivered + c.waiting + c.problem === 0
    ? `${label}: not used`
    : `${label}: ${c.delivered} delivered · ${c.waiting} waiting for the carrier · ${c.problem} not delivered`;
}

/** 旧页面 .sp。 */
function Pill({ pill }: { pill: StatusPill | null }) {
  if (!pill) return <span className="text-[#ccc]">—</span>;
  return (
    <span
      className={cn(
        "inline-block rounded-[10px] px-2 py-0.5 text-[11px] whitespace-nowrap",
        TONE_CLASS[pill.tone],
      )}
    >
      {pill.label}
    </span>
  );
}

/** 旧页面 .log-tbl（批次里的表没有外框，直接放在 .batch-body 上）。 */
const TH =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-2.5 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#999]";
/** 字色 #444 写在 tbody 上（cn 不合并冲突的 class）。 */
const TD = "px-2.5 py-2 align-middle";
const TR =
  "border-b-[0.5px] border-black/[.06] last:border-b-0 hover:bg-[#fafaf8]";
/** 旧页面 .batch-sub。 */
const SUB = "mt-3 mb-1.5 text-[12px] font-semibold text-[#555]";

function BatchDetail({
  b,
  onRefresh,
}: {
  b: SendBatchDetail;
  onRefresh: () => void;
}) {
  const s = b.summary;
  const page =
    b.module === "tickets_reminder" ? "Tickets Reminder" : "Tour Confirmation";
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap gap-2">
        <Stat n={s.file_rows} label="In the file" />
        <Stat n={s.sent} label="Sent" className="text-[#3B6D11]" />
        <Stat n={s.failed} label="Failed" />
        <Stat n={s.skipped} label="Skipped" />
        {s.not_sent ? <Stat n={s.not_sent} label="Not sent" /> : null}
      </div>
      <div className="mb-2.5 text-[12px] leading-[1.8] text-[#555]">
        📧 {deliveryLine(s.email, "Email")}
        <br />
        📱 {deliveryLine(s.sms, "SMS")}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-2 cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-white px-2.5 py-[3px] text-[12px] text-[#888]"
        >
          ↻ Refresh
        </button>
      </div>
      {s.failed || s.not_sent ? (
        <p
          data-testid="batch-warn"
          className="mb-2.5 rounded-lg border border-[#f0b4b4] bg-[#fdecec] px-3 py-2 text-[12px] leading-[1.7] text-[#7a1f1f]"
        >
          Some orders did not go out
          {s.not_sent
            ? ` (Not sent: the page lost contact before they were sent, or the send was stopped with an error on the ${page} page)`
            : ""}
          . If something really went wrong, wait a few minutes, then send again
          from {page}: upload the file again. Orders already sent are skipped
          and never sent twice.
        </p>
      ) : null}
      <h3 className={SUB}>Messages ({b.rows.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={TH}>Sent At</th>
              <th className={TH}>Order #</th>
              <th className={TH}>Name</th>
              <th className={TH}>Phone / Email</th>
              <th className={TH}>📧 Email</th>
              <th className={TH}>📱 SMS</th>
            </tr>
          </thead>
          <tbody className="text-[#444]">
            {b.rows.length ? (
              b.rows.map((r, i) => (
                <tr key={i} className={TR}>
                  <td className={cn(TD, "text-[11px] whitespace-nowrap")}>
                    {r.sent_at}
                  </td>
                  <td className={cn(TD, "font-medium text-[#378ADD]")}>
                    {r.order_number || "—"}
                  </td>
                  <td className={TD}>{r.name}</td>
                  <td className={cn(TD, "text-[11px]")}>
                    {r.phone}
                    <br />
                    {r.email}
                  </td>
                  <td className={TD}>
                    <Pill
                      pill={r.email_status ? emailStatus(r.email_status) : null}
                    />
                  </td>
                  <td className={TD}>
                    <Pill
                      pill={r.sms_status ? smsStatus(r.sms_status) : null}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-3.5 text-center text-[#ccc]">
                  Nothing was sent in this batch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {b.skipped.length ? (
        <>
          <h3 className={SUB}>Skipped ({b.skipped.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className={TH}>Order #</th>
                  <th className={TH}>Name</th>
                  <th className={TH}>Reason</th>
                </tr>
              </thead>
              <tbody className="text-[#444]">
                {b.skipped.map((x, i) => (
                  <tr key={i} data-skip className={TR}>
                    <td className={cn(TD, "font-medium text-[#378ADD]")}>
                      {x.order_number || "—"}
                    </td>
                    <td className={TD}>{x.name}</td>
                    <td className={TD}>
                      <span className="inline-block rounded-[10px] bg-[#f1efe8] px-2 py-0.5 text-[11px] text-[#5f5e5a]">
                        {x.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** 旧页面 .batch-stats .stat-card。 */
function Stat({
  n,
  label,
  className,
}: {
  n: number;
  label: string;
  className?: string;
}) {
  return (
    <div className="min-w-[80px] rounded-[10px] border-[0.5px] border-black/10 bg-white px-3.5 py-2 text-center">
      <div
        className={cn(
          "text-[18px] font-bold tabular-nums",
          className ?? "text-[#1a1a1a]",
        )}
      >
        {n}
      </div>
      <div className="mt-0.5 text-[11px] text-[#aaa]">{label}</div>
    </div>
  );
}
