"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  DOR_WIDGET_ID,
  fetchOperationReports,
  fetchReportAssignees,
  updateDashboardWidgets,
  updateOperationReport,
} from "@/lib/daily-report-api";
import { cn } from "@/lib/utils";
import type {
  OperationReportCreateResult,
  OperationReportList,
  OperationReportPatch,
  ReportAssignee,
} from "@/types";

import { TYPE_LABEL, TYPE_TEXT_CLASS } from "./config";
import { LogIncidentDialog } from "./log-incident-dialog";
import { ReportItem } from "./report-item";
import { useDorVisible } from "./use-dor-visible";

export const LOG_BUTTON_CLASS =
  "rounded-[9px] border border-[#f8fafc] bg-[#f8fafc] px-[13px] py-1.5 text-[12.5px] font-bold text-[#06101c] hover:bg-[#e2e8f0]";

/** 保存后的一句话：通知总开关关着（skipped）就明说没通知，不显示成「已通知」。 */
export function savedMessage(result: OperationReportCreateResult): string {
  // duplicate:true 时 notification 是 null（同一个 client_token 再提交，不重复写库也不重复通知）。
  if (result.duplicate || !result.notification) return "Already saved.";
  const { skipped } = result.notification;
  if (skipped === "error") return "Saved. The notification could not be sent.";
  return skipped
    ? "Saved. Notifications are off."
    : "Saved. People in charge notified.";
}

/**
 * Dashboard「Daily operation report」块（Annie 2026-10-24 通过设计稿）：只列未结（Open / In progress），
 * 右上「+ Log an incident」（白底深字，不是蓝色）。板块默认只 Super Admin 可见（visible_to_me），
 * 不可见时整块不画、也不请求 DOR 接口。
 */
export function DorSection({
  onUnauthorized,
  canEdit,
  isSuperAdmin,
}: {
  onUnauthorized: () => void;
  canEdit: boolean;
  isSuperAdmin: boolean;
}) {
  const { state, staffSees, setStaffSees } = useDorVisible(onUnauthorized);
  if (state !== "visible") return null;
  return (
    <DorBlock
      onUnauthorized={onUnauthorized}
      canEdit={canEdit}
      // 只有 Super Admin 看得到开关；其他人看到板块说明已经放给员工了。
      visibility={
        isSuperAdmin ? { staffSees, onChanged: setStaffSees } : undefined
      }
    />
  );
}

/** 板块「员工可见 / 不可见」开关（Annie 2026-10-24 选 A：标题行右侧，旁边一行字写明状态）。 */
function StaffVisibilitySwitch({
  staffSees,
  busy,
  onToggle,
}: {
  staffSees: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-white/60">
      <span
        data-staff-state
        className={cn(
          "font-bold",
          staffSees ? "text-[#4ade80]" : "text-[#fbbf24]",
        )}
      >
        <span
          aria-hidden
          className="mr-1.5 inline-block size-2 rounded-full bg-current"
        />
        {staffSees ? "Visible to staff" : "Staff can’t see this"}
      </span>
      {/* 开 = 绿（员工看得到），关 = 灰；不用蓝色（蓝色只给提交键）。 */}
      <button
        type="button"
        role="switch"
        aria-checked={staffSees}
        aria-label="Show this block to staff"
        disabled={busy}
        onClick={onToggle}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border disabled:opacity-60",
          "after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:transition-transform",
          staffSees
            ? "border-[#4ade80] bg-[#4ade80]/[.28] after:translate-x-4 after:bg-[#4ade80]"
            : "border-white/35 bg-white/10 after:bg-[#cbd5e1]",
        )}
      />
    </span>
  );
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: OperationReportList };

function DorBlock({
  onUnauthorized,
  canEdit,
  visibility,
}: {
  onUnauthorized: () => void;
  canEdit: boolean;
  /** 只有 Super Admin 传：开关当前状态 + 切换成功后的回调。 */
  visibility?: { staffSees: boolean; onChanged: (staffSees: boolean) => void };
}) {
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [assignees, setAssignees] = useState<ReportAssignee[]>([]);
  const [logging, setLogging] = useState(false);
  const [toast, setToast] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchOperationReports({}, controller.signal);
        if (!controller.signal.aborted) setState({ kind: "ready", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setState({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, onUnauthorized]);

  useEffect(() => {
    if (!canEdit) return;
    const controller = new AbortController();
    fetchReportAssignees(controller.signal)
      .then(setAssignees)
      .catch(() => undefined);
    return () => controller.abort();
  }, [canEdit]);

  async function handlePatch(
    id: number,
    patch: OperationReportPatch,
  ): Promise<string | null> {
    try {
      await updateOperationReport(id, patch);
      reload();
      return null;
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      return describeError(error);
    }
  }

  // 切换员工可见：PUT 只有 Super Admin 能写；成功后以后端返回的为准，失败原样显示原因。
  async function toggleStaffSees() {
    if (!visibility || switching) return;
    const next = !visibility.staffSees;
    setSwitching(true);
    setSwitchError("");
    try {
      const result = await updateDashboardWidgets({
        [DOR_WIDGET_ID]: next ? "staff" : "super_admin_only",
      });
      const widget = result.widgets.find((w) => w.key === DOR_WIDGET_ID);
      const staffSees = widget ? widget.visibility === "staff" : next;
      visibility.onChanged(staffSees);
      setToast(
        staffSees
          ? "Staff can now see this block."
          : "Staff can no longer see this block.",
      );
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setSwitchError(describeError(error));
    } finally {
      setSwitching(false);
    }
  }

  const data = state.kind === "ready" ? state.data : null;
  const items = data?.items ?? [];
  // 还没放给员工时（Super Admin 才看得到这块）：黄色虚线边框，和别的实线板块区分开。
  const hiddenFromStaff = !!visibility && !visibility.staffSees;

  return (
    <section
      aria-label="Daily Operation Report"
      data-staff-hidden={hiddenFromStaff || undefined}
      className={cn(
        "db-section mb-[18px] rounded-[16px] border px-[18px] py-4",
        hiddenFromStaff
          ? "border-dashed border-[#fbbf24]/50"
          : "border-white/[.14]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="db-title text-[15px]">Daily operation report</h2>
        {data ? (
          <span className="flex flex-wrap gap-x-3 text-[11.5px] font-bold">
            {(["complaint", "accident", "emergency"] as const).map((t) => (
              <span key={t} className={TYPE_TEXT_CLASS[t]}>
                {TYPE_LABEL[t]} {data.counts[t]}
              </span>
            ))}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {visibility ? (
            <StaffVisibilitySwitch
              staffSees={visibility.staffSees}
              busy={switching}
              onToggle={() => void toggleStaffSees()}
            />
          ) : null}
          <button
            type="button"
            onClick={() => {
              setToast("");
              setLogging(true);
            }}
            className={LOG_BUTTON_CLASS}
          >
            + Log an incident
          </button>
        </div>
      </div>
      {switchError ? (
        <p role="alert" className="mt-1.5 text-[12.5px] text-[#f87171]">
          Could not change who can see this block: {switchError}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p className="mt-2 text-[12.5px] text-white/60">Loading…</p>
      ) : state.kind === "error" ? (
        <p role="alert" className="mt-2 text-[12.5px] text-[#f87171]">
          Failed to load reports: {state.message}{" "}
          <button type="button" onClick={reload} className="underline">
            Retry
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-white/60">
          No unresolved incidents.
        </p>
      ) : (
        <>
          <p className="mt-0.5 mb-3 text-[12.5px] text-white/60">
            Open and in-progress records only · {data?.total} unresolved
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((report) => (
              <ReportItem
                key={report.id}
                report={report}
                canEdit={canEdit}
                assignees={assignees}
                onPatch={handlePatch}
              />
            ))}
          </ul>
        </>
      )}

      <div className="mt-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1.5 text-[12.5px] text-white/60">
        <span role="status" className="min-h-[18px] text-[#86efac]">
          {toast}
        </span>
        <Link
          href="/daily-report"
          className="text-[#f8fafc] underline underline-offset-[3px]"
        >
          View reports →
        </Link>
      </div>

      {logging ? (
        <LogIncidentDialog
          onClose={() => setLogging(false)}
          onUnauthorized={onUnauthorized}
          onCreated={(result) => {
            setLogging(false);
            setToast(savedMessage(result));
            reload();
          }}
        />
      ) : null}
    </section>
  );
}
