"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError, isStatus } from "@/lib/api-errors";
import { commitHRImport, previewHRImport } from "@/lib/hr-api";
import { cn } from "@/lib/utils";
import type { HRImportPreview, HRImportResult, HRImportRow } from "@/types";

import { choiceText, FIELD_BY_KEY, fieldLabel } from "./fields";

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

  return (
    <section
      aria-label="Import from Excel"
      className="rounded-lg border border-stone-200 bg-white px-4 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-900">
          Import from Excel
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={committing}
          className={SECONDARY_BUTTON_CLASS}
        >
          Close
        </button>
      </div>
      <div className="flex flex-col gap-2 text-sm text-stone-600">
        <p>
          The file can be .csv or .xlsx. The first row must be a header row.
          Columns are matched by name, not position — any order works, and extra
          columns are ignored. Legal Name is required, and it is how a row is
          matched to a person.
        </p>
        <p>
          Without the box ticked, people already on the list are skipped and
          never changed. With it ticked, only columns present in your file are
          written, and only where your file has a value. A blank cell never
          clears what is stored — to empty a field, use Edit list or open that
          person, where blank means what you typed.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
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
          className="text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overwrite}
            disabled={committing}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          Also update people already on the list
        </label>
      </div>

      {result ? (
        <p
          role="status"
          className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {resultText(result)}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p className="mt-3 text-sm text-stone-500">Reading the file…</p>
      ) : state.kind === "error" ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.message}
        </p>
      ) : preview ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-700">
            <span>New: {preview.counts.new}</span>
            {preview.overwrite ? (
              <>
                <span>Will update: {preview.counts.update}</span>
                <span>No change: {preview.counts.unchanged}</span>
              </>
            ) : (
              <span>Already on the list: {preview.counts.exists}</span>
            )}
            <span>Repeated in this file: {preview.counts.duplicate}</span>
            {preview.overwrite ? (
              <span>
                Columns that will be written:{" "}
                {preview.file_columns
                  .filter((k) => k !== "legal_name")
                  .map(fieldLabel)
                  .join(", ") || "—"}
              </span>
            ) : null}
          </p>
          <div className="max-h-[420px] overflow-auto rounded-md border border-stone-200">
            <table className="w-max min-w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-stone-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-stone-600">
                    Import
                  </th>
                  {preview.headers.map((k) => (
                    <th
                      key={k}
                      className="px-2 py-1.5 text-left font-semibold whitespace-nowrap text-stone-600"
                    >
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
          {commitError ? (
            <p role="alert" className="text-sm text-red-700">
              {commitError}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              disabled={writable === 0 || committing}
              onClick={() => void commit()}
              className={PRIMARY_BUTTON_CLASS}
            >
              {committing
                ? "Importing…"
                : preview.overwrite && preview.counts.update > 0
                  ? `Import and update ${preview.counts.update}`
                  : "Import"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const BADGE: Record<HRImportRow["status"], string> = {
  new: "bg-emerald-100 text-emerald-800",
  update: "bg-amber-100 text-amber-900",
  exists: "bg-stone-100 text-stone-500",
  unchanged: "bg-stone-100 text-stone-500",
  duplicate_in_file: "bg-stone-100 text-stone-500",
};

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
  const muted =
    row.status === "exists" ||
    row.status === "unchanged" ||
    row.status === "duplicate_in_file";
  return (
    <tr
      data-status={row.status}
      className={cn(
        "border-t border-stone-100",
        row.status === "update" && "bg-amber-50/60",
        muted && "text-stone-400",
      )}
    >
      <td className="px-2 py-1 whitespace-nowrap">
        <span
          className={cn("rounded px-1.5 py-0.5 font-medium", BADGE[row.status])}
        >
          {badgeText(row)}
        </span>
      </td>
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
              "px-2 py-1 whitespace-nowrap",
              row.changed.includes(k) && "outline outline-1 outline-[#c9a227]",
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
