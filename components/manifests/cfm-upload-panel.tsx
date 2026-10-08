"use client";

import { useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { isStatus } from "@/lib/api-errors";
import { fetchAllManifestRowsForDate } from "@/lib/manifests-api";
import {
  buildManifestOrderIndex,
  CfmImportColumnsError,
  matchCfmImportRows,
  parseCfmImportFile,
  writeCfmRows,
  type CfmImportPreviewRow,
  type CfmImportStatus,
  type CfmWriteResult,
} from "@/lib/manifests-cfm-import";
import { EmptySpreadsheetError, readSpreadsheet } from "@/lib/spreadsheet";
import { cn } from "@/lib/utils";

import { plural } from "./config";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: CfmImportPreviewRow[] };

type CommitState =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; results: CfmWriteResult[] };

const STATUS_LABEL: Record<CfmImportStatus, string> = {
  match: "will insert",
  pax_mismatch: "pax mismatch",
  ambiguous: "multiple matches",
  duplicate_in_file: "duplicate in file",
  missing: "—",
  no_order_number: "—",
  no_confirmation: "—",
};

const STATUS_BADGE: Record<CfmImportStatus, string> = {
  match: "bg-emerald-100 text-emerald-800",
  pax_mismatch: "bg-red-100 text-red-800",
  ambiguous: "bg-red-100 text-red-800",
  duplicate_in_file: "bg-red-100 text-red-800",
  missing: "bg-stone-100 text-stone-400",
  no_order_number: "bg-stone-100 text-stone-400",
  no_confirmation: "bg-stone-100 text-stone-400",
};

const RED_STATUSES: readonly CfmImportStatus[] = [
  "pax_mismatch",
  "ambiguous",
  "duplicate_in_file",
];

/**
 * Cfm # 批量上传（Max 2026-10-08 定）：没有后端接口，匹配和写入全在前端——读文件、拉当天两个标签
 * 全部胶囊的订单在浏览器里核对，只有「订单号在系统里唯一、人数（如果文件有这一列）对得上」才写；
 * 人数对不上、同一订单号系统里不止一行、文件里本身重复，都标红不自动写，交给人工核对。
 */
export function CfmUploadPanel({
  date,
  onClose,
  onInserted,
  onUnauthorized,
}: {
  date: string;
  onClose: () => void;
  /** 至少写成功一条：父组件重拉当前这页，新存的 Cfm # 能显示出来（如果正好在看的胶囊里）。 */
  onInserted: () => void;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [commit, setCommit] = useState<CommitState>({ kind: "idle" });

  async function onFile(file: File) {
    setCommit({ kind: "idle" });
    setState({ kind: "loading" });
    try {
      const [table, candidates] = await Promise.all([
        readSpreadsheet(file),
        fetchAllManifestRowsForDate(date),
      ]);
      const parsed = parseCfmImportFile(table);
      const index = buildManifestOrderIndex(candidates);
      const rows = matchCfmImportRows(parsed.rows, index);
      setState({ kind: "ready", rows });
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setState({
        kind: "error",
        message:
          e instanceof CfmImportColumnsError || e instanceof EmptySpreadsheetError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not read this file.",
      });
    }
  }

  async function runCommit(matched: CfmImportPreviewRow[]) {
    setCommit({ kind: "running", done: 0, total: matched.length });
    try {
      const results = await writeCfmRows(matched, (done, total) =>
        setCommit({ kind: "running", done, total }),
      );
      setCommit({ kind: "done", results });
      if (results.some((r) => r.ok)) onInserted();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setCommit({ kind: "idle" });
    }
  }

  const rows = state.kind === "ready" ? state.rows : [];
  const matched = rows.filter((r) => r.status === "match");
  const busy = state.kind === "loading" || commit.kind === "running";
  const titleId = "cfm-upload-title";

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[88vh] max-w-5xl flex-col overflow-hidden"
    >
      <div className="border-b border-stone-200 px-5 py-3.5">
        <h2 id={titleId} className="text-base font-semibold text-stone-900">
          Upload confirmation numbers — {date}
        </h2>
        <p className="text-xs text-stone-500">
          A vendor&apos;s spreadsheet (.csv or .xlsx) with an order number
          column and a confirmation number column. Matched against{" "}
          {date} only, across every tab and group on that day.
        </p>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-sm">
        <input
          type="file"
          aria-label="Confirmation spreadsheet"
          accept=".csv,.xlsx"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
          className="text-sm"
        />

        {state.kind === "loading" ? (
          <p className="text-stone-500">
            Reading the file and today&apos;s Manifests…
          </p>
        ) : null}

        {state.kind === "error" ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800"
          >
            {state.message}
          </p>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <PreviewSummary rows={rows} />
            <PreviewTable rows={rows} />
          </>
        ) : null}

        {commit.kind === "done" ? (
          <CommitSummary results={commit.results} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-5 py-3">
        <span className="text-xs text-stone-500">
          {commit.kind === "running"
            ? `Inserting ${commit.done} / ${commit.total}…`
            : null}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          <button
            type="button"
            disabled={busy || matched.length === 0 || commit.kind === "done"}
            onClick={() => void runCommit(matched)}
            className={PRIMARY_BUTTON_CLASS}
          >
            {commit.kind === "running"
              ? "Inserting…"
              : `Insert ${plural(matched.length, "confirmation number")}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewSummary({ rows }: { rows: CfmImportPreviewRow[] }) {
  const counts = rows.reduce<Partial<Record<CfmImportStatus, number>>>(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const blank = (counts.no_order_number ?? 0) + (counts.no_confirmation ?? 0);
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-stone-700">
      <span>{plural(rows.length, "row")} read</span>
      <span className="font-medium text-emerald-700">
        Will insert: {counts.match ?? 0}
      </span>
      {counts.pax_mismatch ? (
        <span className="text-red-700">
          Pax mismatch: {counts.pax_mismatch}
        </span>
      ) : null}
      {counts.ambiguous ? (
        <span className="text-red-700">
          Multiple matches: {counts.ambiguous}
        </span>
      ) : null}
      {counts.duplicate_in_file ? (
        <span className="text-red-700">
          Duplicate in file: {counts.duplicate_in_file}
        </span>
      ) : null}
      {counts.missing ? <span>Not found: {counts.missing}</span> : null}
      {blank ? <span>Blank row: {blank}</span> : null}
    </p>
  );
}

function PreviewTable({ rows }: { rows: CfmImportPreviewRow[] }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-stone-200">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-stone-50">
          <tr>
            {[
              "Status",
              "Service Date",
              "Order #",
              "Pax",
              "Lead Name",
              "Confirmation #",
              "Note",
            ].map((h) => (
              <th
                key={h}
                className="px-2 py-1.5 text-left font-semibold whitespace-nowrap text-stone-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const red = RED_STATUSES.includes(r.status);
            const muted =
              r.status === "missing" ||
              r.status === "no_order_number" ||
              r.status === "no_confirmation";
            const systemPax = r.target?.systemPax;
            return (
              <tr
                key={r.file.line}
                className={cn(
                  "border-t border-stone-100",
                  red && "bg-red-50/60",
                  muted && "text-stone-400",
                )}
              >
                <td className="px-2 py-1 whitespace-nowrap">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-medium",
                      STATUS_BADGE[r.status],
                    )}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {r.file.serviceDate || "—"}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {r.file.orderNumber || "—"}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {r.file.pax ?? "—"}
                  {systemPax !== undefined &&
                  systemPax !== null &&
                  systemPax !== r.file.pax
                    ? ` (system: ${systemPax})`
                    : ""}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {r.file.leadName || "—"}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {r.file.confirmationNo || "—"}
                </td>
                <td className="px-2 py-1 whitespace-nowrap text-stone-500">
                  {r.reason || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CommitSummary({ results }: { results: CfmWriteResult[] }) {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="font-medium text-stone-800">
        Inserted {plural(ok, "confirmation number")}
        {failed.length ? `, ${failed.length} failed` : ""}.
      </p>
      {failed.length ? (
        <ul className="mt-1 list-disc pl-5 text-red-700">
          {failed.map((f) => (
            <li key={f.row.file.line}>
              {f.row.file.orderNumber}: {f.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
