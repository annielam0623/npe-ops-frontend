"use client";

import { useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchAllManifestRowsForDate } from "@/lib/manifests-api";
import {
  buildManifestOrderIndex,
  CfmImportColumnsError,
  checkCfmRows,
  matchCfmImportRows,
  parseCfmImportFile,
  writeCfmRows,
  type CfmCheckedRow,
  type CfmImportPreviewRow,
  type CfmImportStatus,
  type CfmWriteEntry,
  type CfmWriteResult,
} from "@/lib/manifests-cfm-import";
import { EmptySpreadsheetError, readSpreadsheet } from "@/lib/spreadsheet";
import { cn } from "@/lib/utils";

import { plural } from "./config";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      rows: CfmImportPreviewRow[];
      /** 后端对比的结果，按文件行号找。 */
      checked: Map<number, CfmCheckedRow>;
    };

type CommitState =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | {
      kind: "done";
      results: CfmWriteResult[];
      saved: number;
      overwritten: number;
      kept: number;
    };

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
  // night: = 全深色主题（lib/theme.ts），平时不生效。
  match:
    "bg-emerald-100 text-emerald-800 night:bg-emerald-400/15 night:text-emerald-200",
  pax_mismatch:
    "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
  ambiguous: "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
  duplicate_in_file:
    "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
  missing:
    "bg-stone-100 text-stone-400 night:bg-white/[.06] night:text-white/40",
  no_order_number:
    "bg-stone-100 text-stone-400 night:bg-white/[.06] night:text-white/40",
  no_confirmation:
    "bg-stone-100 text-stone-400 night:bg-white/[.06] night:text-white/40",
};

const RED_STATUSES: readonly CfmImportStatus[] = [
  "pax_mismatch",
  "ambiguous",
  "duplicate_in_file",
];

const BADGE_NEW =
  "bg-emerald-100 text-emerald-800 night:bg-emerald-400/15 night:text-emerald-200";
const BADGE_GREY =
  "bg-stone-100 text-stone-500 night:bg-white/[.06] night:text-white/50";
const BADGE_DIFF =
  "bg-amber-100 text-amber-900 night:bg-amber-400/15 night:text-amber-200";
const BADGE_SENT =
  "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200";

/**
 * Cfm # 批量上传（Max 2026-10-08 定）：读文件、拉当天两个标签全部胶囊的订单在浏览器里核对，
 * 「订单号在系统里唯一、人数（如果文件有这一列）对得上」的才会往下走；人数对不上、同一订单号系统里不止一行、
 * 文件里本身重复，都标红不自动写。
 * 2026-10-17 起（Annie 方案 B）：往下走的行先调后端对比（POST /api/manifests/cfm/preview，只读），
 * 没有号的才直接写；已有不同号（含文件里是空的）列出「现有 → 文件」，默认保留旧值，staff 勾 Overwrite 才覆盖；
 * 已发过门票提醒的整行红底。对比失败整个上传停下，不盲写。
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
  /** 勾了 Overwrite 的文件行号。 */
  const [overwrite, setOverwrite] = useState<ReadonlySet<number>>(new Set());

  async function onFile(file: File) {
    setCommit({ kind: "idle" });
    setOverwrite(new Set());
    setState({ kind: "loading" });
    try {
      const [table, candidates] = await Promise.all([
        readSpreadsheet(file),
        fetchAllManifestRowsForDate(date),
      ]);
      const parsed = parseCfmImportFile(table);
      const index = buildManifestOrderIndex(candidates);
      const rows = matchCfmImportRows(parsed.rows, index);
      let checkedList: CfmCheckedRow[];
      try {
        checkedList = await checkCfmRows(rows, date);
      } catch (e) {
        if (isStatus(e, 401)) throw e;
        setState({
          kind: "error",
          message: `Could not compare with the saved numbers: ${
            e instanceof TypeError
              ? "could not reach the server"
              : describeError(e)
          }. Nothing was saved. Choose the file again.`,
        });
        return;
      }
      setState({
        kind: "ready",
        rows,
        checked: new Map(checkedList.map((c) => [c.row.file.line, c])),
      });
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setState({
        kind: "error",
        message:
          e instanceof CfmImportColumnsError ||
          e instanceof EmptySpreadsheetError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not read this file.",
      });
    }
  }

  const rows = state.kind === "ready" ? state.rows : [];
  const checked = state.kind === "ready" ? state.checked : null;
  const checkedAll = checked ? [...checked.values()] : [];
  const newRows = checkedAll.filter((c) => c.check === "new");
  const different = checkedAll.filter((c) => c.check === "different");
  const ticked = different.filter((c) => overwrite.has(c.row.file.line));
  const kept = different.length - ticked.length;
  const toWrite: CfmWriteEntry[] = [...newRows, ...ticked].map((c) => ({
    row: c.row,
    confirmationNo: c.incoming,
  }));

  async function runCommit() {
    const entries = toWrite;
    setCommit({ kind: "running", done: 0, total: entries.length });
    try {
      const results = await writeCfmRows(entries, (done, total) =>
        setCommit({ kind: "running", done, total }),
      );
      const okLines = new Set(
        results.filter((r) => r.ok).map((r) => r.row.file.line),
      );
      setCommit({
        kind: "done",
        results,
        saved: newRows.filter((c) => okLines.has(c.row.file.line)).length,
        overwritten: ticked.filter((c) => okLines.has(c.row.file.line)).length,
        kept,
      });
      if (results.some((r) => r.ok)) onInserted();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setCommit({ kind: "idle" });
    }
  }

  const busy = state.kind === "loading" || commit.kind === "running";
  const titleId = "cfm-upload-title";
  const overwriteCount = ticked.length;
  const saveLabel =
    commit.kind === "running"
      ? "Saving…"
      : overwriteCount === 0
        ? `Save ${plural(newRows.length, "confirmation number")}`
        : newRows.length === 0
          ? `Overwrite ${overwriteCount}`
          : `Save ${newRows.length} and overwrite ${overwriteCount}`;

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[88vh] max-w-5xl flex-col overflow-hidden"
      night
    >
      <div className="border-b border-stone-200 px-5 py-3.5 night:border-white/10">
        <h2
          id={titleId}
          className="text-base font-semibold text-stone-900 night:text-white"
        >
          Upload confirmation numbers — {date}
        </h2>
        <p className="text-xs text-[#1a1a1a] night:text-white/50">
          A vendor&apos;s spreadsheet (.csv or .xlsx) with an order number
          column and a confirmation number column. Matched against {date} only,
          across every tab and group on that day. It is compared with the
          numbers already saved; nothing changes until you click Save.
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
          <p className="text-[#1a1a1a] night:text-white/50">
            Reading the file and comparing with the saved numbers…
          </p>
        ) : null}

        {state.kind === "error" ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 night:border-red-500/30 night:bg-red-500/10 night:text-red-200"
          >
            {state.message}
          </p>
        ) : null}

        {state.kind === "ready" && checked ? (
          <>
            <PreviewSummary rows={rows} checked={checked} />
            {different.length ? (
              <div
                data-cfm-warn
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 night:border-amber-400/30 night:bg-amber-400/10 night:text-amber-200"
              >
                {plural(different.length, "order")}{" "}
                {different.length === 1 ? "has" : "have"} a Cfm # that the file
                changes. {different.length === 1 ? "It keeps" : "They keep"} the
                saved number unless you tick Overwrite.
                {different.some((c) => c.alreadySent) ? (
                  <b>
                    {" "}
                    {different.filter((c) => c.alreadySent).length} of them
                    already got a ticket reminder.
                  </b>
                ) : null}
              </div>
            ) : null}
            <PreviewTable
              rows={rows}
              checked={checked}
              overwrite={overwrite}
              disabled={busy || commit.kind === "done"}
              onToggle={(line, on) =>
                setOverwrite((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(line);
                  else next.delete(line);
                  return next;
                })
              }
            />
            {different.length ? (
              <p className="flex flex-wrap gap-x-4 text-xs">
                <button
                  type="button"
                  disabled={busy || commit.kind === "done"}
                  onClick={() =>
                    setOverwrite(
                      new Set(
                        different
                          .filter((c) => !c.alreadySent)
                          .map((c) => c.row.file.line),
                      ),
                    )
                  }
                  className="cursor-pointer text-blue-700 underline disabled:opacity-50 night:text-sky-300"
                >
                  Tick Overwrite on the ones not yet sent
                </button>
                <button
                  type="button"
                  disabled={busy || commit.kind === "done"}
                  onClick={() => setOverwrite(new Set())}
                  className="cursor-pointer text-blue-700 underline disabled:opacity-50 night:text-sky-300"
                >
                  Keep all saved numbers
                </button>
              </p>
            ) : null}
          </>
        ) : null}

        {commit.kind === "done" ? (
          <CommitSummary
            results={commit.results}
            saved={commit.saved}
            overwritten={commit.overwritten}
            kept={commit.kept}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-5 py-3 night:border-white/10">
        <span
          data-cfm-plan
          className="text-xs text-[#1a1a1a] night:text-white/50"
        >
          {commit.kind === "running"
            ? `Saving ${commit.done} / ${commit.total}…`
            : state.kind === "ready"
              ? `Will save ${newRows.length} new, overwrite or clear ${overwriteCount}, keep ${kept} saved ${kept === 1 ? "number" : "numbers"}.`
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
            disabled={busy || toWrite.length === 0 || commit.kind === "done"}
            onClick={() => void runCommit()}
            className={cn(DARK_PRIMARY_BUTTON_CLASS)}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewSummary({
  rows,
  checked,
}: {
  rows: CfmImportPreviewRow[];
  checked: Map<number, CfmCheckedRow>;
}) {
  const counts = rows.reduce<Partial<Record<CfmImportStatus, number>>>(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const c = [...checked.values()];
  const n = (k: CfmCheckedRow["check"]) =>
    c.filter((x) => x.check === k).length;
  const blank = (counts.no_order_number ?? 0) + (counts.no_confirmation ?? 0);
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[#1a1a1a] night:text-white/80">
      <span>{plural(rows.length, "row")} read</span>
      <span className="font-medium text-emerald-700 night:text-emerald-300">
        New: {n("new")}
      </span>
      {n("same") ? <span>Same, skipped: {n("same")}</span> : null}
      {n("different") ? (
        <span className="font-medium text-amber-700 night:text-amber-300">
          Different from saved: {n("different")}
        </span>
      ) : null}
      {n("not_found") ? <span>Not found: {n("not_found")}</span> : null}
      {counts.pax_mismatch ? (
        <span className="text-red-700 night:text-red-300">
          Pax mismatch: {counts.pax_mismatch}
        </span>
      ) : null}
      {counts.ambiguous ? (
        <span className="text-red-700 night:text-red-300">
          Multiple matches: {counts.ambiguous}
        </span>
      ) : null}
      {counts.duplicate_in_file ? (
        <span className="text-red-700 night:text-red-300">
          Duplicate in file: {counts.duplicate_in_file}
        </span>
      ) : null}
      {counts.missing ? <span>Not found: {counts.missing}</span> : null}
      {blank ? <span>Blank row: {blank}</span> : null}
    </p>
  );
}

function PreviewTable({
  rows,
  checked,
  overwrite,
  disabled,
  onToggle,
}: {
  rows: CfmImportPreviewRow[];
  checked: Map<number, CfmCheckedRow>;
  overwrite: ReadonlySet<number>;
  disabled: boolean;
  onToggle: (line: number, on: boolean) => void;
}) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-stone-200 night:border-white/10">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-paper night:bg-[#0f1d2d]">
          <tr>
            {[
              "Result",
              "Service Date",
              "Order #",
              "Pax",
              "Lead Name",
              "Saved Cfm #",
              "File Cfm #",
              "Overwrite?",
              "Note",
            ].map((h) => (
              <th
                key={h}
                className="px-2 py-1.5 text-left font-semibold whitespace-nowrap text-[#1a1a1a] night:text-white/60"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = checked.get(r.file.line);
            const red = RED_STATUSES.includes(r.status);
            const sentRow = c?.check === "different" && c.alreadySent;
            const diffRow = c?.check === "different" && !c.alreadySent;
            const muted =
              !c &&
              (r.status === "missing" ||
                r.status === "no_order_number" ||
                r.status === "no_confirmation");
            const quiet =
              c?.check === "same" ||
              c?.check === "not_found" ||
              c?.check === "ignore";
            const systemPax = r.target?.systemPax;
            const badge = c
              ? c.check === "new"
                ? { text: "new", cls: BADGE_NEW }
                : c.check === "same"
                  ? { text: "same", cls: BADGE_GREY }
                  : c.check === "not_found"
                    ? { text: "not found", cls: BADGE_GREY }
                    : c.check === "ignore"
                      ? { text: "—", cls: BADGE_GREY }
                      : {
                          text: `different${c.incoming ? "" : " · file is empty"}${c.alreadySent ? " · reminder already sent" : ""}`,
                          cls: c.alreadySent ? BADGE_SENT : BADGE_DIFF,
                        }
              : { text: STATUS_LABEL[r.status], cls: STATUS_BADGE[r.status] };
            const on = overwrite.has(r.file.line);
            return (
              <tr
                key={r.file.line}
                data-cfm-line={r.file.orderNumber}
                className={cn(
                  "border-t border-stone-100 night:border-white/[.06]",
                  red && "bg-red-50/60 night:bg-red-500/10",
                  diffRow && "bg-amber-50 night:bg-amber-400/10",
                  sentRow && "bg-red-50 night:bg-red-500/10",
                  (muted || quiet) && "text-stone-400 night:text-white/40",
                )}
              >
                <td className="px-2 py-1 whitespace-nowrap">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-medium",
                      badge.cls,
                    )}
                  >
                    {badge.text}
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
                  {c?.check === "different" ? (
                    <span className="text-red-700 line-through night:text-red-300">
                      {c.current}
                    </span>
                  ) : (
                    c?.current || "—"
                  )}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {c?.check === "different" && !c.incoming ? (
                    <b className="text-red-700 night:text-red-300">(empty)</b>
                  ) : c?.check === "different" || c?.check === "new" ? (
                    <b className="text-emerald-700 night:text-emerald-300">
                      {r.file.confirmationNo}
                    </b>
                  ) : (
                    r.file.confirmationNo || "—"
                  )}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {c?.check === "different" ? (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Overwrite ${r.file.orderNumber}`}
                        checked={on}
                        disabled={disabled}
                        onChange={(e) =>
                          onToggle(r.file.line, e.target.checked)
                        }
                      />
                      Overwrite
                      {c.alreadySent ? (
                        <small className="text-red-700 night:text-red-300">
                          (guest got the old number)
                        </small>
                      ) : !c.incoming ? (
                        <small className="text-amber-800 night:text-amber-300">
                          (clears the saved number)
                        </small>
                      ) : null}
                    </label>
                  ) : c?.check === "new" ? (
                    "will be saved"
                  ) : c?.check === "same" ? (
                    "nothing to do"
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1 whitespace-nowrap text-[#1a1a1a] night:text-white/50">
                  {c?.check === "not_found"
                    ? "Not on this day's Rezdy list."
                    : r.reason || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CommitSummary({
  results,
  saved,
  overwritten,
  kept,
}: {
  results: CfmWriteResult[];
  saved: number;
  overwritten: number;
  kept: number;
}) {
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="rounded-md border border-stone-200 bg-paper px-3 py-2 night:border-white/10 night:bg-white/[.04]">
      <p className="font-medium text-stone-800 night:text-white/90">
        Saved {plural(saved, "confirmation number")}, overwrote {overwritten},
        kept {kept} saved {kept === 1 ? "number" : "numbers"}
        {failed.length ? `, ${failed.length} failed` : ""}.
      </p>
      {failed.length ? (
        <ul className="mt-1 list-disc pl-5 text-red-700 night:text-red-300">
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
