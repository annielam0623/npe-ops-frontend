"use client";

import { useEffect, useState } from "react";

import { describeError } from "@/lib/api-errors";
import { fetchOperationReport } from "@/lib/daily-report-api";
import { cn } from "@/lib/utils";
import type {
  OperationReport,
  OperationReportHistoryEntry,
  OperationReportPatch,
  ReportAssignee,
  ReportStatus,
} from "@/types";

import {
  ABOUT_LABEL,
  POLICE_LABEL,
  STATUSES,
  STATUS_COLOR_CLASS,
  STATUS_LABEL,
  TYPE_COLOR_CLASS,
  TYPE_LABEL,
  formatWhen,
} from "./config";

const SELECT_CLASS =
  "rounded-md border border-white/25 bg-[#0f2238] px-1.5 py-0.5 text-xs text-[#f8fafc] [color-scheme:dark] disabled:opacity-60";

function detailRows(report: OperationReport): [string, string][] {
  const d = report.details;
  const rows: [string, string][] = [];
  if (d.occurred_at) rows.push(["Time", formatWhen(d.occurred_at)]);
  if (d.location) rows.push(["Location", d.location]);
  if (d.vehicle_no) rows.push(["Vehicle #", d.vehicle_no]);
  if (d.driver_name) rows.push(["Driver", d.driver_name]);
  if (d.injuries) rows.push(["Injuries", d.injuries]);
  if (d.police_report)
    rows.push(["Police report", POLICE_LABEL[d.police_report]]);
  return rows;
}

function describeChange(
  change: OperationReportHistoryEntry["changes"][number],
) {
  if (change.field === "status") {
    const label = (v: unknown) => STATUS_LABEL[v as ReportStatus] ?? String(v);
    return `Status ${label(change.from)} → ${label(change.to)}`;
  }
  if (change.field === "follow_up_user_id") return "Follow-up changed";
  return `${change.field} changed`;
}

function historyLine(entry: OperationReportHistoryEntry): string {
  const what =
    entry.action === "create"
      ? "Registered"
      : entry.changes.length
        ? entry.changes.map(describeChange).join(", ")
        : "Edited";
  return `${what} by ${entry.by} · ${formatWhen(entry.at)}`;
}

/**
 * 一条记录（Dashboard 块和 View reports 页共用）：类型 · 对谁 · 订单号 · 一句话 · 状态 · 跟进人。
 * 能改的人（canEdit：本人登记的、或有 report.edit，见 use-report-editor.ts）可改状态和跟进人，其他人只看。展开才去取详情里的修改记录。
 */
export function ReportItem({
  report,
  canEdit,
  assignees,
  defaultExpanded = false,
  onPatch,
}: {
  report: OperationReport;
  canEdit: boolean;
  assignees: ReportAssignee[];
  defaultExpanded?: boolean;
  /** 返回错误文字；成功返回 null。 */
  onPatch: (id: number, patch: OperationReportPatch) => Promise<string | null>;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [history, setHistory] = useState<OperationReportHistoryEntry[] | null>(
    null,
  );
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 记录被改过（updated_at 变）后，已经展开的历史要重新取。
  const updatedAt = report.updated_at;
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setHistoryError("");
    fetchOperationReport(report.id, controller.signal)
      .then((detail) => setHistory(detail.history))
      .catch((err) => {
        if (!controller.signal.aborted) setHistoryError(describeError(err));
      });
    return () => controller.abort();
  }, [expanded, report.id, updatedAt]);

  async function patch(change: OperationReportPatch) {
    if (busy) return;
    setBusy(true);
    setError("");
    const message = await onPatch(report.id, change);
    if (message) setError(message);
    setBusy(false);
  }

  const rows = detailRows(report);
  const followUpId = report.follow_up?.id;
  const subject = report.headline || report.subject_name || "";

  return (
    <li
      data-report-id={report.id}
      className="rounded-xl border border-white/[.14] bg-white/[.03] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "rounded-md border px-[7px] py-px text-[10px] font-extrabold tracking-[.06em] uppercase",
            TYPE_COLOR_CLASS[report.report_type],
          )}
        >
          {TYPE_LABEL[report.report_type]}
          {report.complaint_about
            ? ` · ${ABOUT_LABEL[report.complaint_about]}`
            : ""}
        </span>
        {subject ? (
          <span className="text-[13.5px] font-bold">{subject}</span>
        ) : null}
        <span className="font-mono text-[11.5px] text-white/60">
          {report.order_number || "no order #"}
        </span>
        <span className="ml-auto text-[11.5px] text-white/60">
          {formatWhen(report.created_at)} · by {report.created_by.display_name}
        </span>
      </div>

      <p className="mt-1 text-[13.5px] break-words whitespace-pre-wrap">
        {report.what_happened}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
        <span
          className={cn(
            "rounded-full border px-2.5 py-px text-[11.5px] font-bold",
            STATUS_COLOR_CLASS[report.status],
          )}
        >
          {STATUS_LABEL[report.status]}
        </span>
        {canEdit ? (
          <>
            <label className="flex items-center gap-1">
              Status
              <select
                aria-label={`Status of report ${report.id}`}
                value={report.status}
                disabled={busy}
                onChange={(e) =>
                  void patch({ status: e.target.value as ReportStatus })
                }
                className={SELECT_CLASS}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              Follow-up
              <select
                aria-label={`Follow-up of report ${report.id}`}
                value={followUpId ? String(followUpId) : ""}
                disabled={busy}
                onChange={(e) =>
                  void patch({
                    follow_up_user_id: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                className={SELECT_CLASS}
              >
                <option value="">Not assigned</option>
                {/* 跟进人已停用 / 不在下拉里时，也要有这一项，否则看起来像没指定。 */}
                {followUpId && !assignees.some((u) => u.id === followUpId) ? (
                  <option value={String(followUpId)}>
                    {report.follow_up?.display_name}
                  </option>
                ) : null}
                {assignees.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.display_name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <span>
            Follow-up: {report.follow_up?.display_name ?? "not assigned yet"}
          </span>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs underline underline-offset-2 hover:text-white"
        >
          {expanded ? "Hide details" : "Details"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-xs text-[#f87171]">
          {error}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-2 border-t border-white/10 pt-2 text-[12.5px] text-white/60">
          {rows.length ? (
            <dl className="mb-1.5 grid grid-cols-[max-content_1fr] gap-x-2.5 gap-y-0.5">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-white/40">{k}</dt>
                  <dd className="m-0 text-[#f8fafc]">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div>
            {historyError
              ? `History unavailable: ${historyError}`
              : history
                ? `History: ${history.map(historyLine).join(" → ")}`
                : "Loading history…"}
          </div>
        </div>
      ) : null}
    </li>
  );
}
