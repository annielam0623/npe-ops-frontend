"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { commitImport, previewImport } from "@/lib/bulk-import-api";
import { cn } from "@/lib/utils";
import type { ImportCommitResult, ImportPreviewResponse } from "@/types";

/**
 * 全站「上传表格自动填进去」（Annie 2026-10-29 动手：「批量导游同意推荐。动手」；
 * preview https://claude.ai/artifact/MKtDUiYyUPZ1FcBJR3j4Lw ，Q1–Q7 全按推荐）。
 *
 * 每页同一个样子：⬇ Download template（带现有记录）→ 选 .xlsx / .csv → 后端出预览（只读）→
 * 每行 New / Update / No change / Error，改了的格子黄框（有旧值写「旧 → 新」），有错的整行淡红、红字写原因 →
 * 按蓝色 Save 才写；有错的行不存（Q2），空格不清空（Q3）。成功绿字、失败红字（全站规矩）。
 * 各页只管「哪些栏、按什么对上、调哪对接口」，把后端的预览换成 `BulkImportPreview`。
 */

export type BulkImportStatus = "new" | "update" | "unchanged" | "error";

export interface BulkImportRow {
  status: BulkImportStatus;
  /** 文件里这一行的值（键 = 栏的 key），显示用的文字。 */
  values: Record<string, string>;
  /** 改前的值（后端给了才有）：改了的格子写「旧 → 新」。 */
  before?: Record<string, string>;
  /** 要写的栏。 */
  changed?: string[];
  /** 文件里空着、所以不改的栏（Q3：空格不清空）。 */
  blanked?: string[];
  /** field = null：整行的错（例如对不上），写在这一行下面。 */
  errors?: { field: string | null; message: string }[];
  /** 不是错的说明（例如「matched by alias …」），灰字写在下面。 */
  note?: string;
}

export interface BulkImportColumn {
  key: string;
  label: string;
}

export interface BulkImportPreview {
  columns: BulkImportColumn[];
  rows: BulkImportRow[];
}

type ReadState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; preview: BulkImportPreview };

const STATUS_TEXT: Record<BulkImportStatus, string> = {
  new: "New",
  update: "Update",
  unchanged: "No change",
  error: "Error",
};

const STATUS_CLASS: Record<BulkImportStatus, string> = {
  new: "bg-[#e0ecff] text-[#1e40af] night:bg-blue-400/15 night:text-blue-200",
  update:
    "bg-[#fff4d6] text-[#7a5300] night:bg-amber-400/15 night:text-amber-200",
  unchanged:
    "bg-[#f1f2f4] text-[#6b7280] night:bg-white/10 night:text-white/55",
  error: "bg-[#fde8e8] text-[#b3261e] night:bg-red-500/15 night:text-red-300",
};

const CARD_CLASS =
  "mb-5 overflow-hidden rounded-[12px] border-[0.5px] border-black/10 night:border-white/10 bg-paper night:bg-white/[.04] text-[#1a1a1a] night:text-white/90";
const HEADER_CLASS =
  "flex flex-wrap items-center justify-between gap-2.5 border-b-[0.5px] border-black/[.08] night:border-white/10 bg-paper night:bg-white/[.03] px-4 py-3";
const BTN_CLASS =
  "inline-flex h-8 cursor-pointer items-center rounded-[7px] border-[0.5px] border-black/20 night:border-white/10 bg-paper night:bg-white/[.04] px-3 text-[12.5px] font-semibold whitespace-nowrap text-[#1a1a1a] night:text-white/90 hover:bg-[#f4f4f2] night:hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-60";
/** 蓝色只给提交键（Annie 2026-10-11）。 */
const SAVE_CLASS =
  "inline-flex h-8 cursor-pointer items-center rounded-[7px] border-none bg-[#3b82f6] px-4 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-45";
const TH_CLASS =
  "border-b-[0.5px] border-black/10 night:border-white/10 bg-[#fafafa] night:bg-white/[.03] px-2.5 py-[7px] text-left text-[11px] font-semibold whitespace-nowrap text-[#6b7280] night:text-white/55";
const TD_CLASS =
  "border-b-[0.5px] border-black/[.06] night:border-white/10 px-2.5 py-[7px] align-top";
const GREEN = "text-[#1e6b43] night:text-emerald-300";
const RED = "text-[#b3261e] night:text-red-300";

/** 列表卡片标题右边的「⬆ Import」键（灰白，不是蓝的）。 */
export function BulkImportButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={BTN_CLASS}
    >
      ⬆ Import
    </button>
  );
}

function rowsLabel(n: number): string {
  return `${n} row${n === 1 ? "" : "s"}`;
}

export function BulkImport({
  title,
  help,
  template,
  preview,
  commit,
  atomic,
  describe,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  /** 卡片标题，例如「Import drivers & guides」。 */
  title: string;
  /** 选文件下面那段说明：按什么对上、空格不清空。 */
  help: ReactNode;
  /** 下载模板：列名就是栏名，带上现有记录（Q5）。 */
  template: () => Promise<{ blob: Blob; filename: string }>;
  preview: (file: File, signal: AbortSignal) => Promise<BulkImportPreview>;
  /** 只写 New / Update 的行；返回 Saved 后面那句（例如「1 new, 2 updated.」）。 */
  commit: (file: File) => Promise<string>;
  /** 后端整份一个事务：失败时能说「nothing was changed」。 */
  atomic: boolean;
  describe: (error: unknown) => string;
  onClose: () => void;
  /** 存好了：父组件重拉列表、日志。 */
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState<ReadState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [templating, setTemplating] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const describeRef = useRef(describe);
  describeRef.current = describe;

  // 选了文件就预览（只读，不写库）。
  useEffect(() => {
    if (!file) {
      setRead({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setRead({ kind: "reading" });
    setSaveError(null);
    previewRef
      .current(file, controller.signal)
      .then((p) => setRead({ kind: "ready", preview: p }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setRead({ kind: "failed", message: describeRef.current(error) });
      });
    return () => controller.abort();
  }, [file]);

  async function downloadTemplate() {
    if (templating) return;
    setTemplating(true);
    setTemplateError(null);
    try {
      const { blob, filename } = await template();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setTemplateError(
        error instanceof TypeError
          ? "Couldn't reach the server — no template was downloaded."
          : `Couldn't download the template — ${describe(error)}`,
      );
    } finally {
      setTemplating(false);
    }
  }

  const ready = read.kind === "ready" ? read.preview : null;
  const count = (s: BulkImportStatus) =>
    ready ? ready.rows.filter((r) => r.status === s).length : 0;
  const toSave = count("new") + count("update");
  const errors = count("error");

  async function save() {
    if (!file || !ready || saving || toSave === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const text = await commit(file);
      const skipped =
        errors > 0
          ? ` ${rowsLabel(errors)} with errors ${errors === 1 ? "was" : "were"} not saved.`
          : "";
      setSaved(`Saved — ${text}${skipped}`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onSaved();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      const reason =
        error instanceof TypeError
          ? "Couldn't reach the server; try Save again."
          : describe(error);
      setSaveError(
        atomic
          ? `Not saved — nothing was changed. ${reason}`
          : `Not saved — ${reason}`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label={title} data-bulk-import className={CARD_CLASS}>
      <div className={HEADER_CLASS}>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void downloadTemplate()}
            disabled={templating || saving}
            className={BTN_CLASS}
          >
            {templating ? "Preparing…" : "⬇ Download template"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={BTN_CLASS}
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        {templateError ? (
          <p role="alert" className={cn("text-[12.5px]", RED)}>
            {templateError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor={fileId} className={BTN_CLASS}>
            {file ? "Choose another file" : "Choose file"}
          </label>
          <input
            ref={inputRef}
            id={fileId}
            type="file"
            accept=".csv,.xlsx"
            disabled={saving}
            onChange={(e) => {
              setSaved(null);
              setFile(e.target.files?.[0] ?? null);
            }}
            className="sr-only"
          />
          {file ? (
            <span className="text-[12.5px]" data-bulk-file>
              📄 {file.name}
            </span>
          ) : null}
        </div>
        <p className="text-[11.5px] leading-[1.5] text-[#4b5563] night:text-white/55">
          .xlsx or .csv. The first row is the header; columns are matched by
          name, in any order, and extra columns are ignored. {help}
        </p>
        {saved ? (
          <p role="status" className={cn("text-[12.5px] font-semibold", GREEN)}>
            ✓ {saved}
          </p>
        ) : null}
        {read.kind === "reading" ? (
          <p className="text-[12.5px]">Reading the file…</p>
        ) : read.kind === "failed" ? (
          <p
            role="alert"
            className={cn("text-[12.5px] whitespace-pre-wrap", RED)}
          >
            {read.message}
          </p>
        ) : ready ? (
          <p className="flex flex-wrap gap-3.5 text-[12.5px]" data-bulk-counts>
            <span>
              New: <b className="tabular-nums">{count("new")}</b>
            </span>
            <span>
              Will update: <b className="tabular-nums">{count("update")}</b>
            </span>
            <span>
              No change: <b className="tabular-nums">{count("unchanged")}</b>
            </span>
            {errors > 0 ? (
              <span className={RED}>
                Errors: <b className="tabular-nums">{errors}</b> —{" "}
                {errors === 1
                  ? "this row won't be saved"
                  : "these rows won't be saved"}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {ready ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Import</th>
                  {ready.columns.map((c) => (
                    <th key={c.key} className={TH_CLASS}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ready.rows.map((row, i) => (
                  <PreviewRow key={i} row={row} columns={ready.columns} />
                ))}
              </tbody>
            </table>
          </div>
          {saveError ? (
            <p
              role="alert"
              className={cn(
                "px-4 pt-2.5 text-[12.5px] font-semibold whitespace-pre-wrap",
                RED,
              )}
            >
              {saveError}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2.5 px-4 py-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={BTN_CLASS}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || toSave === 0}
              className={SAVE_CLASS}
            >
              {saving ? "Saving…" : `Save ${rowsLabel(toSave)}`}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function PreviewRow({
  row,
  columns,
}: {
  row: BulkImportRow;
  columns: BulkImportColumn[];
}) {
  const isError = row.status === "error";
  const rowErrors = (row.errors ?? []).filter((e) => e.field === null);
  const tone = cn(
    isError && "bg-[#fff6f6] night:bg-red-500/[.06]",
    row.status === "unchanged" && "text-[#9ca3af] night:text-white/35",
  );
  return (
    <>
      <tr data-status={row.status} className={tone}>
        <td className={TD_CLASS}>
          <span
            className={cn(
              "inline-block rounded-[6px] px-[7px] py-px text-[11px] font-bold whitespace-nowrap",
              STATUS_CLASS[row.status],
            )}
          >
            {STATUS_TEXT[row.status]}
          </span>
        </td>
        {columns.map((c) => {
          const text = row.values[c.key] ?? "";
          const fieldErrors = (row.errors ?? []).filter(
            (e) => e.field === c.key,
          );
          const changed =
            row.status === "update" && (row.changed ?? []).includes(c.key);
          const blanked = (row.blanked ?? []).includes(c.key);
          const before = row.before?.[c.key];
          return (
            <td key={c.key} className={TD_CLASS}>
              {fieldErrors.length > 0 ? (
                <>
                  <span className="rounded-[3px] px-1 py-px font-semibold text-[#b3261e] shadow-[inset_0_0_0_1px_#e8a3a3] night:text-red-300">
                    {text || "(empty)"}
                  </span>
                  {fieldErrors.map((e, k) => (
                    <span
                      key={k}
                      data-bulk-error
                      className={cn("mt-0.5 block text-[11.5px]", RED)}
                    >
                      {e.message}
                    </span>
                  ))}
                </>
              ) : changed ? (
                <span
                  data-bulk-changed
                  className="rounded-[3px] px-1 py-px font-semibold text-[#7a5300] shadow-[inset_0_0_0_1px_#d8a01f] night:text-amber-200"
                >
                  {before !== undefined ? (
                    <>
                      <span className="font-normal text-[#9ca3af] line-through">
                        {before || "—"}
                      </span>{" "}
                      →{" "}
                    </>
                  ) : null}
                  {text || "—"}
                </span>
              ) : (
                text
              )}
              {blanked && row.status !== "new" ? (
                <span className="block text-[11.5px] text-[#6b7280] night:text-white/45">
                  blank in file — left as is
                </span>
              ) : null}
            </td>
          );
        })}
      </tr>
      {rowErrors.length > 0 || row.note ? (
        <tr className={tone}>
          <td colSpan={columns.length + 1} className={cn(TD_CLASS, "pt-0")}>
            {rowErrors.map((e, k) => (
              <span
                key={k}
                data-bulk-error
                className={cn("block text-[11.5px]", RED)}
              >
                {e.message}
              </span>
            ))}
            {row.note ? (
              <span className="block text-[11.5px] text-[#6b7280] night:text-white/45">
                {row.note}
              </span>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** 标准接口的预览换成 `BulkImportPreview`：栏名用页面上的，按别名对上写一句说明。 */
export function fromImportResponse(
  p: ImportPreviewResponse,
  labelOf: (key: string) => string,
): BulkImportPreview {
  return {
    columns: p.columns.map((k) => ({ key: k, label: labelOf(k) })),
    rows: p.rows.map((row) => ({
      status: row.status,
      values: row.values,
      before: row.before,
      changed: row.changed,
      blanked: row.blanked,
      errors: row.errors,
      note: row.matched_alias
        ? `Matched by alias “${row.matched_alias}”.`
        : undefined,
    })),
  };
}

export function importResultText(r: ImportCommitResult): string {
  const parts: string[] = [];
  if (r.created) parts.push(`${r.created} new`);
  if (r.updated) parts.push(`${r.updated} updated`);
  return `${parts.join(", ") || "nothing to change"}.`;
}

/**
 * 走标准接口（`<endpoint>/preview`、`<endpoint>/commit`，见 types/bulk-import.ts）的页面直接用这个：
 * 整份一个事务（atomic），模板由页面在浏览器里用现有记录生成。
 */
export function StandardImport({
  title,
  help,
  endpoint,
  labelOf,
  template,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  title: string;
  help: ReactNode;
  /** 例如 `/api/vehicles/import`。 */
  endpoint: string;
  labelOf: (key: string) => string;
  template: () => { blob: Blob; filename: string };
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <BulkImport
      title={title}
      help={help}
      template={async () => template()}
      preview={async (file, signal) =>
        fromImportResponse(await previewImport(endpoint, file, signal), labelOf)
      }
      commit={async (file) =>
        importResultText(await commitImport(endpoint, file))
      }
      atomic
      describe={describeError}
      onClose={onClose}
      onSaved={onSaved}
      onUnauthorized={onUnauthorized}
    />
  );
}
