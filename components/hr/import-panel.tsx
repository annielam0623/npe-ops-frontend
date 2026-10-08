"use client";

import { useEffect, useId, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { commitHRImport, previewHRImport } from "@/lib/hr-api";
import { cn } from "@/lib/utils";
import type { HRImportPreview, HRImportResult, HRImportRow } from "@/types";

import { choiceText, FIELD_BY_KEY, fieldLabel } from "./fields";
import {
  HR_BTN_CLASS,
  HR_BTN_PRIMARY_CLASS,
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
} from "./legacy-ui";

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; preview: HRImportPreview };

interface ImportPanelProps {
  onClose: () => void;
  /** 导入成功：父组件重拉列表和日志。 */
  onImported: () => void;
  onUnauthorized: () => void;
}

export function ImportPanel({
  onClose,
  onImported,
  onUnauthorized,
}: ImportPanelProps) {
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<HRImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  // 选了文件或改了勾选就重新预览（只读，不写库）。
  useEffect(() => {
    if (!file) {
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    setCommitError(null);
    previewHRImport(file, overwrite, controller.signal)
      .then((preview) => setState({ kind: "ready", preview }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [file, overwrite]);

  async function commit() {
    if (!file || committing || state.kind !== "ready") return;
    setCommitting(true);
    setCommitError(null);
    try {
      const done = await commitHRImport(file, overwrite);
      setResult(done);
      // 导入完回到初始状态（同旧页面：勾选也复位）。
      setFile(null);
      setOverwrite(false);
      if (inputRef.current) inputRef.current.value = "";
      onImported();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setCommitError(`Nothing was imported: ${describeError(error)}`);
    } finally {
      setCommitting(false);
    }
  }

  const preview = state.kind === "ready" ? state.preview : null;
  const writable = preview ? preview.counts.new + preview.counts.update : 0;

  const importLabel = committing
    ? "Importing…"
    : preview?.overwrite && preview.counts.update > 0
      ? `Import and update ${preview.counts.update}`
      : "Import";

  return (
    <section aria-label="Import from Excel" className={HR_CARD_CLASS}>
      <div className={HR_CARD_HEADER_CLASS}>
        <h2 className={HR_CARD_TITLE_CLASS}>Import from Excel</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={committing}
          className={HR_BTN_CLASS}
        >
          Close
        </button>
      </div>
      <div className="p-4 text-[#1a1a1a]">
        {/* .imp-row：选文件 + Import 键（同旧页面）。 */}
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor={fileId} className="sr-only">
            Spreadsheet file
          </label>
          <input
            ref={inputRef}
            id={fileId}
            type="file"
            accept=".csv,.xlsx"
            disabled={committing}
            onChange={(e) => {
              setResult(null);
              setFile(e.target.files?.[0] ?? null);
            }}
            className="text-[13px]"
          />
          <button
            type="button"
            disabled={!preview || writable === 0 || committing}
            onClick={() => void commit()}
            className={HR_BTN_PRIMARY_CLASS}
          >
            {importLabel}
          </button>
        </div>
        {/* .imp-ow */}
        <label className="mt-2.5 flex cursor-pointer items-center gap-[7px] text-[12.5px] text-[#555] select-none">
          <input
            type="checkbox"
            checked={overwrite}
            disabled={committing}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="h-[15px] w-[15px] cursor-pointer"
          />
          Also update people already on the list
        </label>
        <div className="mt-2 text-[11.5px] leading-[1.5] text-[#aaa]">
          The file can be .csv or .xlsx. The first row must be a header row.
          Columns are matched by name, not position — any order works, and extra
          columns are ignored. <b>Legal Name is required</b>, and it is how a
          row is matched to a person.
          <br />
          Without the box ticked, people already on the list are skipped and
          never changed. With it ticked,{" "}
          <b>
            only columns present in your file are written, and only where your
            file has a value
          </b>
          . A blank cell never clears what is stored — to empty a field, use{" "}
          <b>Edit list</b> or open that person, where blank means what you
          typed.
        </div>

        {result ? (
          <p role="status" className="mt-2 text-[12.5px] text-[#1e6b43]">
            {resultText(result)}
          </p>
        ) : null}

        {state.kind === "loading" ? (
          <p className="mt-3 text-[12.5px] text-[#888]">Reading the file…</p>
        ) : state.kind === "error" ? (
          <p
            role="alert"
            className="mt-2 text-[12.5px] whitespace-pre-wrap text-[#b3261e]"
          >
            {state.message}
          </p>
        ) : preview ? (
          <>
            {/* .imp-counts */}
            <p className="mt-3 flex flex-wrap gap-3.5 text-[12.5px] text-[#555]">
              <span>
                New: <b className="tabular-nums">{preview.counts.new}</b>
              </span>
              {preview.overwrite ? (
                <>
                  <span>
                    Will update:{" "}
                    <b className="tabular-nums">{preview.counts.update}</b>
                  </span>
                  <span>
                    No change:{" "}
                    <b className="tabular-nums">{preview.counts.unchanged}</b>
                  </span>
                </>
              ) : (
                <span>
                  Already on the list:{" "}
                  <b className="tabular-nums">{preview.counts.exists}</b>
                </span>
              )}
              <span>
                Repeated in this file:{" "}
                <b className="tabular-nums">{preview.counts.duplicate}</b>
              </span>
              {preview.overwrite ? (
                <span className="text-[#7a5300]">
                  Columns that will be written:{" "}
                  <b>
                    {preview.file_columns
                      .filter((k) => k !== "legal_name")
                      .map(fieldLabel)
                      .join(", ") || "—"}
                  </b>
                </span>
              ) : null}
            </p>
            {commitError ? (
              <p
                role="alert"
                className="mt-2 text-[12.5px] whitespace-pre-wrap text-[#b3261e]"
              >
                {commitError}
              </p>
            ) : null}
            <div className="overflow-x-auto">
              {/* table.prev */}
              <table className="mt-3 w-full min-w-[700px] border-collapse text-[12px] text-[#1a1a1a]">
                <thead>
                  <tr>
                    <th className={PREV_TH}>Import</th>
                    {preview.headers.map((k) => (
                      <th key={k} className={PREV_TH}>
                        {fieldLabel(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <PreviewRow key={i} row={row} headers={preview.headers} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** table.prev th */
const PREV_TH =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-2.5 py-[7px] text-left text-[10.5px] whitespace-nowrap text-[#888] uppercase";

function badgeText(row: HRImportRow): string {
  const blank =
    row.blanked.length > 0
      ? ` (${row.blanked.length} blank cell(s) left as-is)`
      : "";
  switch (row.status) {
    case "new":
      return "will import";
    case "exists":
      return "skipped — already here";
    case "duplicate_in_file":
      return "skipped — repeated above";
    case "update":
      return `will update — ${row.changed.length} field(s)${blank}`;
    case "unchanged":
      return `no change${blank}`;
    default:
      return row.status;
  }
}

function PreviewRow({ row, headers }: { row: HRImportRow; headers: string[] }) {
  // 只有 new 和 update 会真的写库；其余灰掉（tr.skip）。会被覆盖的行淡黄（tr.upd），真会变的格子再描边。
  const skip = row.status !== "new" && row.status !== "update";
  const upd = row.status === "update";
  const td = cn(
    "border-b-[0.5px] border-black/[.06] px-2.5 py-[7px] whitespace-nowrap",
    skip ? "bg-[#fafafa] text-[#999]" : "text-[#1a1a1a]",
    upd && "bg-[#fffdf5]",
  );
  return (
    <tr data-status={row.status}>
      <td className={td}>{badgeText(row)}</td>
      {headers.map((k) => {
        const field = FIELD_BY_KEY[k];
        const raw = row[k] ?? "";
        // 后端给的单选是存的值（例如 full_time），这里换成标签，和多选一致。
        const text =
          field?.kind === "choice" ? (raw ? choiceText(field, raw) : "") : raw;
        return (
          <td
            key={k}
            className={cn(
              td,
              upd &&
                row.changed.includes(k) &&
                "font-semibold text-[#7a5300] shadow-[inset_0_0_0_1px_#d8a01f]",
            )}
          >
            {text}
          </td>
        );
      })}
    </tr>
  );
}

function resultText(r: HRImportResult): string {
  const parts = [`Imported ${r.imported}`];
  if (r.updated) parts.push(`updated ${r.updated}`);
  if (r.unchanged) parts.push(`${r.unchanged} already matched`);
  parts.push(
    `skipped ${r.skipped}${r.skipped_names.length ? ` (${r.skipped_names.join(", ")})` : ""}`,
  );
  if (r.vanished) {
    parts.push(`${r.vanished} were deleted by someone else and skipped`);
  }
  return `${parts.join(", ")}.`;
}
