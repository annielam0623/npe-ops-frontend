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
  if (result.duplicate) return "Already saved.";
  return result.notification.skipped
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
}: {
  onUnauthorized: () => void;
  canEdit: boolean;
}) {
  const visibility = useDorVisible(onUnauthorized);
  if (visibility !== "visible") return null;
  return <DorBlock onUnauthorized={onUnauthorized} canEdit={canEdit} />;
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: OperationReportList };

function DorBlock({
  onUnauthorized,
  canEdit,
}: {
  onUnauthorized: () => void;
  canEdit: boolean;
}) {
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

  const data = state.kind === "ready" ? state.data : null;
  const items = data?.items ?? [];

  return (
    <section
      aria-label="Daily Operation Report"
      className="db-section mb-[18px] rounded-[16px] border border-white/[.14] px-[18px] py-4"
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
        <button
          type="button"
          onClick={() => {
            setToast("");
            setLogging(true);
          }}
          className={cn(LOG_BUTTON_CLASS, "ml-auto")}
        >
          + Log an incident
        </button>
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
