"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchOperationReports,
  fetchReportAssignees,
  updateOperationReport,
} from "@/lib/daily-report-api";
import { cn } from "@/lib/utils";
import type {
  CurrentUser,
  OperationReportCreateResult,
  OperationReportList,
  OperationReportPatch,
  ReportAssignee,
} from "@/types";

import { DOR_CHANGED_EVENT, TYPE_LABEL, TYPE_TEXT_CLASS } from "./config";
import { LogIncidentDialog } from "./log-incident-dialog";
import { ReportItem } from "./report-item";
import { useDorVisible } from "./use-dor-visible";
import { canEditReport, useReportEditor } from "./use-report-editor";
import { VisibilityControl } from "@/components/ui/visibility-control";

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
  me,
  isSuperAdmin,
}: {
  onUnauthorized: () => void;
  /** 能不能改按每一条判断（本人改自己的、report.edit 改所有人的，见 use-report-editor.ts）。 */
  me: CurrentUser;
  isSuperAdmin: boolean;
}) {
  const { state, staffSees } = useDorVisible(onUnauthorized);
  if (state !== "visible") return null;
  return (
    <DorBlock
      onUnauthorized={onUnauthorized}
      me={me}
      // 只有 Super Admin 看得到「谁看得到」控件；员工看不到这块时（Super Admin 那边）画虚线框。
      isSuperAdmin={isSuperAdmin}
      hiddenFromStaff={isSuperAdmin && !staffSees}
    />
  );
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: OperationReportList };

function DorBlock({
  onUnauthorized,
  me,
  isSuperAdmin,
  hiddenFromStaff,
}: {
  onUnauthorized: () => void;
  me: CurrentUser;
  isSuperAdmin: boolean;
  /** 员工看不到（不是 Everyone）：黄色虚线边框，和别的实线板块区分开。 */
  hiddenFromStaff: boolean;
}) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const editor = useReportEditor(me);
  const [assignees, setAssignees] = useState<ReportAssignee[]>([]);
  const [logging, setLogging] = useState(false);
  const [toast, setToast] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
    // 统计块的 Open reports 数跟着刷新。
    window.dispatchEvent(new Event(DOR_CHANGED_EVENT));
  }, []);

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

  // 跟进人下拉：能改哪一条（哪怕只是自己登记的）都要用；partner 不能改，不读。
  const editAny = !editor.partner;
  useEffect(() => {
    if (!editAny) return;
    const controller = new AbortController();
    fetchReportAssignees(controller.signal)
      .then(setAssignees)
      .catch(() => undefined);
    return () => controller.abort();
  }, [editAny]);

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

  const data = state.kind === "ready" ? state.data : null;
  const items = data?.items ?? [];

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
          {isSuperAdmin ? (
            <VisibilityControl
              pageKey="daily_operation_report"
              onUnauthorized={onUnauthorized}
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
                canEdit={canEditReport(report, editor)}
                canAddUpdate={!editor.partner}
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
