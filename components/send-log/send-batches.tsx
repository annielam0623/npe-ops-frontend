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
      className="overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-200 bg-[#FAEEDA] px-4 py-2.5">
        <h2 className="text-sm font-semibold text-[#7C4A00]">
          📦 Send batches
        </h2>
        <span className="text-xs text-[#9a6a2a]">
          One block per click on Send in Tickets Reminder or Tour Confirmation.
          Click a block to open it.
        </span>
      </div>
      {list.kind === "loading" ? (
        <p className="px-4 py-3 text-xs text-stone-400">Loading…</p>
      ) : list.kind === "error" ? (
        <p role="alert" className="px-4 py-3 text-xs text-[#A32D2D]">
          Failed to load the send batches: {list.message}
        </p>
      ) : list.batches.length === 0 ? (
        <p className="px-4 py-3 text-xs text-stone-400">
          No send batches for these dates.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200">
          {list.batches.map((b) => {
            const isOpen = open.has(b.id);
            const d = details[b.id];
            const summary = d?.kind === "ready" ? d.detail.summary : b.summary;
            return (
              <li key={b.id} data-batch={b.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(b.id)}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-[13px] text-stone-700 hover:bg-stone-50",
                    isOpen && "bg-[#fffaf0]",
                    b.id === target && "shadow-[inset_3px_0_0_#BA7517]",
                  )}
                >
                  <span aria-hidden className="text-stone-400">
                    {isOpen ? "▼" : "▶"}
                  </span>
                  <span className="font-bold text-stone-900">
                    Sent at {b.started_at}
                  </span>
                  <span className="text-stone-500">
                    {b.tour_label || b.tour_type} · Tour date{" "}
                    {b.tour_date || "—"} · by {b.sent_by || "—"}
                  </span>
                  <Chips s={summary} />
                </button>
                {isOpen ? (
                  <div className="bg-[#fffdf8] px-4 pt-3 pb-4">
                    {!d || d.kind === "loading" ? (
                      <p className="text-sm text-stone-400">Loading…</p>
                    ) : d.kind === "error" ? (
                      <p role="alert" className="text-sm text-[#A32D2D]">
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

const CHIP = "rounded-full px-2 py-0.5 text-[11px] font-semibold";

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

function Pill({ pill }: { pill: StatusPill | null }) {
  if (!pill) return <span className="text-stone-300">—</span>;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONE_CLASS[pill.tone],
      )}
    >
      {pill.label}
    </span>
  );
}

const TH =
  "px-3 py-1.5 text-left text-[11px] font-semibold whitespace-nowrap text-stone-500";
const TD = "px-3 py-1.5 align-top";

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
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Stat n={s.file_rows} label="In the file" />
        <Stat n={s.sent} label="Sent" className="text-[#3B6D11]" />
        <Stat n={s.failed} label="Failed" className="text-[#A32D2D]" />
        <Stat n={s.skipped} label="Skipped" />
        {s.not_sent ? (
          <Stat n={s.not_sent} label="Not sent" className="text-[#185FA5]" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs leading-relaxed text-stone-600">
        <span>
          📧 {deliveryLine(s.email, "Email")}
          <br />
          📱 {deliveryLine(s.sms, "SMS")}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs hover:bg-stone-50"
        >
          ↻ Refresh
        </button>
      </div>
      {s.failed || s.not_sent ? (
        <p
          data-testid="batch-warn"
          className="rounded-md border border-[#f0b4b4] bg-[#fdecec] px-3 py-2 text-xs leading-relaxed text-[#7a1f1f]"
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
      <h3 className="text-xs font-semibold text-stone-600">
        Messages ({b.rows.length})
      </h3>
      <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
        <table className="w-full text-xs">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className={TH}>Sent At</th>
              <th className={TH}>Order #</th>
              <th className={TH}>Name</th>
              <th className={TH}>Phone / Email</th>
              <th className={TH}>📧 Email</th>
              <th className={TH}>📱 SMS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {b.rows.length ? (
              b.rows.map((r, i) => (
                <tr key={i}>
                  <td className={cn(TD, "whitespace-nowrap")}>{r.sent_at}</td>
                  <td className={cn(TD, "font-medium text-[#378ADD]")}>
                    {r.order_number || "—"}
                  </td>
                  <td className={TD}>{r.name}</td>
                  <td className={TD}>
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
                <td
                  colSpan={6}
                  className="px-3 py-3 text-center text-stone-400"
                >
                  Nothing was sent in this batch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {b.skipped.length ? (
        <>
          <h3 className="text-xs font-semibold text-stone-600">
            Skipped ({b.skipped.length})
          </h3>
          <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
            <table className="w-full text-xs">
              <thead className="border-b border-stone-200 bg-stone-50">
                <tr>
                  <th className={TH}>Order #</th>
                  <th className={TH}>Name</th>
                  <th className={TH}>Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {b.skipped.map((x, i) => (
                  <tr key={i} data-skip>
                    <td className={cn(TD, "font-medium text-[#378ADD]")}>
                      {x.order_number || "—"}
                    </td>
                    <td className={TD}>{x.name}</td>
                    <td className={TD}>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
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
    <div className="min-w-[80px] rounded-md border border-stone-200 bg-white px-3 py-1.5 text-center">
      <div className={cn("text-lg font-bold tabular-nums", className)}>{n}</div>
      <div className="text-[11px] text-stone-500">{label}</div>
    </div>
  );
}
