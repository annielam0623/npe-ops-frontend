"use client";

import { useEffect, useState } from "react";

import { describeError } from "@/lib/api-errors";
import { addReportUpdate, fetchOperationReport } from "@/lib/daily-report-api";
import { cn } from "@/lib/utils";
import type {
  NoShowContact,
  NoShowRescheduled,
  OperationReport,
  OperationReportHistoryEntry,
  OperationReportPatch,
  OperationReportUpdate,
  ReportAssignee,
  ReportStatus,
} from "@/types";

import {
  ABOUT_LABEL,
  POLICE_LABEL,
  REASON_LABEL,
  REPORTED_BY_LABEL,
  STATUS_COLOR_CLASS,
  STATUS_LABEL,
  TYPE_COLOR_CLASS,
  TYPE_LABEL,
  formatWhen,
  formatYmd,
  statusOptions,
} from "./config";
import { SelectMenu } from "@/components/ui/select-menu";
import { EarlierRecords } from "./earlier-records";
import { FARM_OUT_TAG_CLASS } from "./log-incident-dialog";
import { NoShowPanel, followUpDueText } from "./no-show-panel";

const noop = () => undefined;

const SELECT_CLASS =
  "rounded-md border border-white/25 bg-[#0f2238] px-1.5 py-0.5 text-xs text-[#f8fafc] [color-scheme:dark] disabled:opacity-60";

function detailRows(report: OperationReport): [string, string][] {
  const d = report.details;
  const rows: [string, string][] = [];
  if (report.report_type === "no_show") {
    if (d.tour_date)
      rows.push([
        "Tour date",
        `${formatYmd(d.tour_date)}${d.product_name ? ` · ${d.product_name}` : ""}`,
      ]);
    if (d.pickup_location) rows.push(["Pickup", d.pickup_location]);
    const crew = [d.driver_name, d.guide_name, d.vehicle].filter(Boolean);
    if (crew.length) rows.push(["Driver / Guide", crew.join(" · ")]);
    if (d.reported_by)
      rows.push(["Reported by", REPORTED_BY_LABEL[d.reported_by]]);
    if (d.reason) rows.push(["Reason", REASON_LABEL[d.reason]]);
    if (d.source === "tracking") rows.push(["Logged from", "Morning Tracking"]);
    return rows;
  }
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

/** Updates 一条最多多少字（后端 G224 同一个上限）。 */
const UPDATE_MAX = 2000;

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
 * 展开后下面列 Updates（G224，从旧到新），能看的人都能加一条（canAddUpdate；partner 不能），只能加不能改、删。
 */
export function ReportItem({
  report,
  canEdit,
  canAddUpdate,
  assignees,
  defaultExpanded = false,
  onPatch,
  isSuperAdmin = false,
  onUnauthorized = noop,
}: {
  report: OperationReport;
  canEdit: boolean;
  /** 能不能加 Updates：能看就能加，partner 不能（G224）。No show 的联系记录同一个口径。 */
  canAddUpdate: boolean;
  assignees: ReportAssignee[];
  defaultExpanded?: boolean;
  /** 返回错误文字；成功返回 null。 */
  onPatch: (id: number, patch: OperationReportPatch) => Promise<string | null>;
  /** No show Evidence 里 Phone AI 那一行只给 Super Admin（G361）。 */
  isSuperAdmin?: boolean;
  onUnauthorized?: () => void;
}) {
  const isNoShow = report.report_type === "no_show";
  const [contacts, setContacts] = useState<NoShowContact[] | null>(null);
  const [rescheduled, setRescheduled] = useState<NoShowRescheduled | null>(
    null,
  );
  const [readyToClose, setReadyToClose] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [history, setHistory] = useState<OperationReportHistoryEntry[] | null>(
    null,
  );
  const [historyError, setHistoryError] = useState("");
  const [updates, setUpdates] = useState<OperationReportUpdate[] | null>(null);
  const [draft, setDraft] = useState("");
  const [updateState, setUpdateState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [updateError, setUpdateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 记录被改过（updated_at 变）后，已经展开的历史要重新取。
  const updatedAt = report.updated_at;
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setHistoryError("");
    fetchOperationReport(report.id, controller.signal)
      .then((detail) => {
        setHistory(detail.history);
        setUpdates(detail.updates ?? []);
        setContacts(detail.contacts ?? []);
        setRescheduled(detail.rescheduled ?? null);
        setReadyToClose(!!detail.ready_to_close);
      })
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

  async function saveUpdate() {
    if (updateState === "saving") return;
    setUpdateState("saving");
    setUpdateError("");
    try {
      const added = await addReportUpdate(report.id, draft.trim());
      setUpdates((list) => [...(list ?? []), added]);
      setDraft("");
      setUpdateState("saved");
    } catch (err) {
      setUpdateError(describeError(err));
      setUpdateState("error");
    }
  }

  const rows = detailRows(report);
  // 加 Updates 在修改记录里是 add_update、没有 changes，不显示（Updates 下面已经列了）。
  const historyShown = history?.filter((h) => h.action !== "add_update");
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
        {report.details.farm_out ? (
          <span data-farm-out className={FARM_OUT_TAG_CLASS}>
            Farm out
          </span>
        ) : null}
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

      {report.what_happened ? (
        <p className="mt-1 text-[13.5px] break-words whitespace-pre-wrap">
          {report.what_happened}
        </p>
      ) : null}

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
              <SelectMenu
                aria-label={`Status of report ${report.id}`}
                value={String(report.status)}
                options={[
                  ...statusOptions(report.status).map((s) => ({
                    value: String(s),
                    label: String(STATUS_LABEL[s]),
                  })),
                ]}
                disabled={busy}
                onChange={(next) =>
                  void patch({ status: next as ReportStatus })
                }
                className={SELECT_CLASS}
              />
            </label>
            {/* T2 A：No show 的跟进人放在 Guest decision 里、跟决定一起存；这里只写文字。 */}
            {isNoShow ? (
              <span data-follow-up-text>
                Follow-up:{" "}
                {report.follow_up?.display_name ?? "not assigned yet"}
                {followUpDueText(report)}
              </span>
            ) : null}
            <label
              className={cn("flex items-center gap-1", isNoShow && "hidden")}
            >
              Follow-up
              <SelectMenu
                aria-label={`Follow-up of report ${report.id}`}
                value={String(followUpId ? String(followUpId) : "")}
                options={[
                  { value: "", label: "Not assigned" },
                  // 跟进人已停用 / 不在下拉里时，也要有这一项，否则看起来像没指定。
                  ...(followUpId && !assignees.some((u) => u.id === followUpId)
                    ? [
                        {
                          value: String(String(followUpId)),
                          label: String(report.follow_up?.display_name),
                        },
                      ]
                    : []),
                  ...assignees.map((u) => ({
                    value: String(String(u.id)),
                    label: String(u.display_name),
                  })),
                ]}
                disabled={busy}
                onChange={(next) =>
                  void patch({
                    follow_up_user_id: next ? Number(next) : null,
                  })
                }
                className={SELECT_CLASS}
              />
            </label>
          </>
        ) : (
          <span>
            Follow-up: {report.follow_up?.display_name ?? "not assigned yet"}
            {isNoShow ? followUpDueText(report) : ""}
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
          {isNoShow ? (
            <div className="mb-2 flex flex-col gap-2.5">
              <NoShowPanel
                report={report}
                contacts={historyError ? [] : contacts}
                rescheduled={rescheduled}
                readyToClose={readyToClose}
                canEdit={canEdit}
                canAddContact={canAddUpdate}
                isSuperAdmin={isSuperAdmin}
                assignees={assignees}
                onContactAdded={(c) =>
                  setContacts((list) => [...(list ?? []), c])
                }
                onPatch={onPatch}
                onUnauthorized={onUnauthorized}
              />
              {report.order_number ? (
                <EarlierRecords
                  orderNumber={report.order_number}
                  excludeId={report.id}
                  onUnauthorized={onUnauthorized}
                />
              ) : null}
            </div>
          ) : null}
          <div>
            {historyError
              ? `History unavailable: ${historyError}`
              : historyShown
                ? `History: ${historyShown.map(historyLine).join(" → ")}`
                : "Loading history…"}
          </div>
          <div data-report-updates className="mt-2">
            <div className="mb-1 text-[11px] font-bold tracking-[.06em] text-white/45 uppercase">
              Updates
            </div>
            {updates === null ? (
              historyError ? null : (
                <p className="m-0">Loading updates…</p>
              )
            ) : updates.length ? (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {updates.map((u) => (
                  <li key={u.id} data-update-id={u.id}>
                    <div className="text-[11.5px] text-white/50">
                      {u.created_by.display_name} · {formatWhen(u.created_at)}
                    </div>
                    <p className="m-0 text-[13px] break-words whitespace-pre-wrap text-[#f8fafc]">
                      {u.text}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0">No updates yet.</p>
            )}
            {canAddUpdate && updates !== null ? (
              <div className="mt-2">
                <textarea
                  aria-label={`Add an update to report ${report.id}`}
                  value={draft}
                  maxLength={UPDATE_MAX}
                  rows={2}
                  placeholder="Add an update…"
                  disabled={updateState === "saving"}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (updateState !== "saving") setUpdateState("idle");
                  }}
                  className="w-full resize-y rounded-md border border-white/25 bg-[#0f2238] px-2 py-1.5 text-[13px] text-[#f8fafc] [color-scheme:dark] placeholder:text-white/35 disabled:opacity-60"
                />
                <div className="mt-1 flex items-center gap-2.5">
                  <button
                    type="button"
                    data-update-save
                    onClick={() => void saveUpdate()}
                    disabled={updateState === "saving"}
                    className="rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-[5px] text-[12.5px] font-bold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save
                  </button>
                  {updateState === "saving" ? (
                    <span className="text-xs text-white/60">Saving…</span>
                  ) : updateState === "saved" ? (
                    <span data-update-saved className="text-xs text-[#4ade80]">
                      Saved
                    </span>
                  ) : updateState === "error" ? (
                    <span role="alert" className="text-xs text-[#f87171]">
                      {updateError}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-white/40">
                    {draft.length} / {UPDATE_MAX}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
