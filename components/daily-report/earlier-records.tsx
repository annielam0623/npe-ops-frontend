"use client";

import { useEffect, useState } from "react";

import { usePhoneCollapse } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchOrderContext } from "@/lib/daily-report-api";
import { noteAuthor } from "@/lib/staff-notes-api";
import { cn } from "@/lib/utils";
import type { OrderContext, OrderReport } from "@/types";

import {
  ABOUT_LABEL,
  STATUS_COLOR_CLASS,
  STATUS_LABEL,
  TYPE_COLOR_CLASS,
  TYPE_LABEL,
  formatWhen,
  formatYmd,
} from "./config";

const SOURCE_LABEL: Record<string, string> = {
  tracking: "from Morning Tracking",
  manifest: "from Main manifest",
  order_details: "from the order page",
};

/** 订单号像样了才查（CHD 号 9 位，Rezdy 号也不会短于 4 位）。 */
export function orderLooksComplete(order: string): boolean {
  return order.trim().length >= 4;
}

/**
 * G361 N6 A「Earlier records」：填了订单号后列这单以前的记录（四类 DOR 登记 + ★ Notes + Relay / Bus 的 No show 标记）。
 * 数据：GET /api/operation-reports/order-context（没有 orders.view 的人后两样的键不在 ⇒ 不出那两段）。只读：
 * 登记点 Open ▸ 就地展开 What happened 和 Updates，最下面「Open in Daily report →」；Note 点 Show ▸ 看全文。
 * 手机上默认收起成一行（手机版规则）。excludeId：登记详情里不再列这份自己。
 */
export function EarlierRecords({
  orderNumber,
  excludeId,
  onUnauthorized,
}: {
  orderNumber: string;
  excludeId?: number;
  onUnauthorized: () => void;
}) {
  const order = orderNumber.trim().toUpperCase();
  const [data, setData] = useState<OrderContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<number | null>(null);
  const [openNote, setOpenNote] = useState<number | null>(null);
  const fold = usePhoneCollapse();

  useEffect(() => {
    setData(null);
    setError(null);
    if (!orderLooksComplete(order)) return;
    const controller = new AbortController();
    // 边打边查太吵：停 400ms 再查。
    const timer = setTimeout(() => {
      fetchOrderContext(order, controller.signal)
        .then((ctx) => setData(ctx))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (isStatus(err, 401)) onUnauthorized();
          else setError(describeError(err));
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [order, onUnauthorized]);

  if (!orderLooksComplete(order)) return null;
  if (error)
    return (
      <p className="text-xs text-[#f87171]">
        Could not load earlier records: {error}
      </p>
    );
  if (!data) return null;

  const reports = data.reports.filter((r) => r.id !== excludeId);
  const notes = data.staff_notes ?? [];
  const marks = data.no_show_marks ?? [];
  const total = reports.length + notes.length + marks.length;

  return (
    <div
      data-earlier-records
      className="flex flex-col gap-2 rounded-[10px] border border-dashed border-[#c4b5fd]/55 bg-black/15 px-3 py-2.5 text-[12.5px]"
    >
      <button
        type="button"
        onClick={fold.toggle}
        className="flex items-center gap-2 text-left text-[11px] font-bold tracking-[.06em] text-white/45 uppercase max-sm:cursor-pointer sm:pointer-events-none"
      >
        Earlier records for {data.order_number} ({total}){fold.caret}
      </button>
      <div className={cn("flex flex-col gap-2", fold.hide)}>
        {total === 0 ? (
          <p className="text-white/45">No earlier records for this order.</p>
        ) : null}
        {reports.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-white/62">
              Daily reports
            </span>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {reports.map((r) => (
                <ReportLine
                  key={r.id}
                  report={r}
                  open={openReport === r.id}
                  onToggle={() =>
                    setOpenReport((cur) => (cur === r.id ? null : r.id))
                  }
                />
              ))}
            </ul>
          </div>
        ) : null}
        {notes.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-white/62">
              ★ Notes
            </span>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {notes.map((n) => {
                const open = openNote === n.id;
                const long = n.body.length > 90;
                return (
                  <li key={n.id} data-earlier-note={n.id} className="min-w-0">
                    <span className="text-[11.5px] text-white/50">
                      {noteAuthor(n)} · {formatWhen(n.created_at)}
                      {n.source && SOURCE_LABEL[n.source]
                        ? ` · ${SOURCE_LABEL[n.source]}`
                        : ""}
                    </span>{" "}
                    <span className="break-words whitespace-pre-wrap text-[#f8fafc]">
                      {open || !long ? n.body : `${n.body.slice(0, 90)}…`}
                    </span>{" "}
                    {long ? (
                      <button
                        type="button"
                        onClick={() => setOpenNote(open ? null : n.id)}
                        className="text-[#38bdf8] hover:underline"
                      >
                        {open ? "Less ▴" : "Show ▸"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {marks.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-white/62">
              No show marks
            </span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[#f8fafc]">
              {marks.map((m, i) => (
                <li key={`${m.tour_date}-${m.col}-${i}`} data-earlier-mark>
                  {formatYmd(m.tour_date)} ·{" "}
                  {m.col === "relay" ? "Relay" : "Bus"}
                  {m.by ? ` · ${m.by}` : ""}
                  {m.source === "field" ? " (field)" : " (office)"}
                  {m.at ? ` · ${formatWhen(m.at)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReportLine({
  report,
  open,
  onToggle,
}: {
  report: OrderReport;
  open: boolean;
  onToggle: () => void;
}) {
  const type =
    report.report_type === "complaint" && report.complaint_about
      ? `${TYPE_LABEL.complaint} · ${ABOUT_LABEL[report.complaint_about]}`
      : TYPE_LABEL[report.report_type];
  return (
    <li data-earlier-report={report.id} className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "rounded-md border px-[7px] py-px text-[10px] font-extrabold tracking-[.06em] uppercase",
            TYPE_COLOR_CLASS[report.report_type],
          )}
        >
          {type}
        </span>
        <span className="text-white/62">{formatWhen(report.created_at)}</span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-px text-[11.5px] font-bold",
            STATUS_COLOR_CLASS[report.status],
          )}
        >
          {STATUS_LABEL[report.status]}
        </span>
        {report.rescheduled_into_this_order ? (
          <span className="text-white/50">
            (rescheduled from {report.order_number})
          </span>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="text-[#38bdf8] hover:underline"
        >
          {open ? "Close ▴" : "Open ▸"}
        </button>
      </div>
      {open ? (
        <div className="mt-1.5 ml-3 flex flex-col gap-1.5 rounded-lg border border-white/12 bg-black/15 px-2.5 py-2">
          {report.what_happened ? (
            <p className="break-words whitespace-pre-wrap text-[#f8fafc]">
              {report.what_happened}
            </p>
          ) : null}
          {report.updates.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {report.updates.map((u) => (
                <li key={u.id}>
                  <span className="text-[11.5px] text-white/50">
                    {u.created_by.display_name || u.created_by.username} ·{" "}
                    {formatWhen(u.created_at)}
                  </span>{" "}
                  <span className="break-words whitespace-pre-wrap text-[#f8fafc]">
                    {u.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-white/45">No updates yet.</p>
          )}
          <a
            href={`/daily-report?id=${report.id}`}
            className="self-start text-[#38bdf8] hover:underline"
          >
            Open in Daily report →
          </a>
        </div>
      ) : null}
    </li>
  );
}
