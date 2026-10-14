"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

/** 补录预览的一行：后端标了 duplicate；Rezdy CSV 的行才有 pax / pax_ok / qty_label。 */
export interface ImportRowBase {
  order_number: string;
  duplicate: boolean;
  pax?: number;
  pax_ok?: boolean;
  qty_label?: string;
}

export interface ImportResultBase {
  inserted: number;
  failed: number;
  errors?: { order_number: string; error: string }[];
  /** 后端用 200 + error 回的失败（门票接口）。 */
  error?: string;
}

export interface ImportColumn<R> {
  head: string;
  cell: (row: R) => ReactNode;
  /** 人数说明（Quantities）：.xlsx 的行没有，整列隐藏（同旧页 `.no-qty-text`）。 */
  qtyText?: boolean;
}

type Step<R> =
  | { kind: "pick"; error: string | null }
  /** 选团那一步已关、等文件选择框（旧页：选团弹窗关掉，直接弹系统选文件）。 */
  | { kind: "file" }
  | { kind: "reading" }
  | { kind: "failed"; message: string }
  | { kind: "preview"; rows: R[]; warning: string; inserting: boolean }
  | { kind: "done"; result: ImportResultBase };

/** Rezdy CSV 才有 pax：算不出人数的行（整批不能插入，同旧页面）。 */
function badPax(rows: ImportRowBase[]): string[] {
  return rows
    .filter((r) => r.pax !== undefined && !r.pax_ok)
    .map((r) => r.order_number);
}

/**
 * Tracking 页 ⬆ Upload 补录，照旧页面（`tracking_tour.html` / `tracking_tickets.html` 的 imp-*）两步：
 * ① 小弹窗选团 → Continue ⇒ 弹系统选文件；② 「Upload to List」预览表，已在列表的整行淡黄 + 橙标签，
 * 逐行 / 表头 Insert anyway 才插入，Insert 只写库、不发消息。
 * 和旧页不同（登记过的全站差异）：选团没选、插入结果、失败写在弹窗里，不用 alert。
 */
export function ImportDialog<R extends ImportRowBase>({
  pickTitle,
  options,
  labelOf,
  columns,
  preview,
  commit,
  onClose,
  onInserted,
  onUnauthorized,
}: {
  /** 第一步标题：Tour「Select Tour Type」、门票「Select Tour / Operator」。 */
  pickTitle: string;
  /** 下拉里的 <option> / <optgroup>（不含第一项「— Select tour type —」）。 */
  options: ReactNode;
  /** 预览标题后面写的团名（旧页取所选 option 的文字）。 */
  labelOf: (tourType: string) => string;
  columns: ImportColumn<R>[];
  preview: (
    file: File,
    tourType: string,
  ) => Promise<{ rows?: R[]; warning?: string; error?: string }>;
  commit: (rows: R[], tourType: string) => Promise<ImportResultBase>;
  onClose: () => void;
  /** 插入成功（哪怕只插了一部分）：表格要重拉。 */
  onInserted: () => void;
  onUnauthorized: () => void;
}) {
  const [tourType, setTourType] = useState("");
  const [step, setStep] = useState<Step<R>>({ kind: "pick", error: null });
  /** 勾了 Insert anyway 的已有单（按行号，同一单可能多行）。 */
  const [forced, setForced] = useState<Set<number>>(new Set());
  const [commitError, setCommitError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepKind = step.kind;

  // 系统选文件框点了取消：整个补录结束（旧页这时什么弹窗都不剩）。
  useEffect(() => {
    const input = fileRef.current;
    if (!input || stepKind !== "file") return;
    const onCancel = () => onClose();
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
  }, [stepKind, onClose]);

  function goContinue() {
    if (!tourType) {
      setStep({ kind: "pick", error: "Select a tour type." });
      return;
    }
    setStep({ kind: "file" });
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  async function readFile(file: File) {
    setStep({ kind: "reading" });
    setForced(new Set());
    setCommitError(null);
    try {
      const data = await preview(file, tourType);
      if (data.error) {
        setStep({ kind: "failed", message: data.error });
        return;
      }
      setStep({
        kind: "preview",
        rows: data.rows ?? [],
        warning: data.warning ?? "",
        inserting: false,
      });
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setStep({
        kind: "failed",
        message: `Upload failed: ${describeError(error)}`,
      });
    }
  }

  async function insert(rows: R[], warning: string) {
    const selected = rows.filter((r, i) => !r.duplicate || forced.has(i));
    if (!selected.length || badPax(rows).length) return;
    setStep({ kind: "preview", rows, warning, inserting: true });
    setCommitError(null);
    try {
      const result = await commit(selected, tourType);
      if (result.error) {
        setCommitError(result.error);
        setStep({ kind: "preview", rows, warning, inserting: false });
        return;
      }
      setStep({ kind: "done", result });
      if (result.inserted) onInserted();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setCommitError(`Insert failed: ${describeError(error)}`);
      setStep({ kind: "preview", rows, warning, inserting: false });
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".csv,.xlsx"
      aria-label="Manifest file"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void readFile(file);
      }}
    />
  );

  if (step.kind === "file") {
    return fileInput;
  }

  if (step.kind === "pick") {
    const titleId = "imp-pick-title";
    return (
      <>
        {fileInput}
        <Modal
          titleId={titleId}
          onDismiss={onClose}
          panelClassName="flex max-w-[420px] flex-col overflow-hidden text-[#1a1a1a]"
        >
          <div className={IMP_HEAD}>
            <h2 id={titleId} className="text-[15px] font-bold">
              {pickTitle}
            </h2>
          </div>
          <div className="flex flex-col gap-2 p-5">
            <select
              aria-label="Tour type"
              value={tourType}
              onChange={(e) => {
                setTourType(e.target.value);
                setStep({ kind: "pick", error: null });
              }}
              className="w-full rounded-[7px] border border-[#cbd5e1] bg-white px-2.5 py-2 text-[13px] text-[#1a1a1a]"
            >
              <option value="">— Select tour type —</option>
              {options}
            </select>
            {step.error ? (
              <p role="alert" className="text-xs text-[#A32D2D]">
                {step.error}
              </p>
            ) : null}
          </div>
          <div className={IMP_FOOT}>
            <button
              type="button"
              onClick={onClose}
              className={cn(IMP_SECONDARY, "ml-auto")}
            >
              Cancel
            </button>
            <button type="button" onClick={goContinue} className={IMP_PRIMARY}>
              Continue
            </button>
          </div>
        </Modal>
      </>
    );
  }

  const titleId = "imp-title";
  const rows = step.kind === "preview" ? step.rows : [];
  const inserting = step.kind === "preview" && step.inserting;
  const dupIndexes = rows.flatMap((r, i) => (r.duplicate ? [i] : []));
  const selected = rows.filter((r, i) => !r.duplicate || forced.has(i)).length;
  const bad = badPax(rows);
  const hasQtyText = rows.length > 0 && rows[0].pax !== undefined;
  const shown = columns.filter((c) => !c.qtyText || hasQtyText);
  const span = shown.length + 2;
  const allForced =
    dupIndexes.length > 0 && dupIndexes.every((i) => forced.has(i));

  function toggle(i: number, on: boolean) {
    const next = new Set(forced);
    if (on) next.add(i);
    else next.delete(i);
    setForced(next);
  }

  function messageRow(text: string, error: boolean) {
    return (
      <tr>
        <td
          colSpan={span}
          role={error ? "alert" : undefined}
          className={cn(
            "p-6 text-center",
            error ? "text-[#cc0000]" : "text-[#999]",
          )}
        >
          {text}
        </td>
      </tr>
    );
  }

  return (
    <>
      {fileInput}
      <Modal
        titleId={titleId}
        onDismiss={inserting || step.kind === "reading" ? undefined : onClose}
        panelClassName="flex max-h-[88vh] max-w-[1150px] flex-col overflow-hidden text-[#1a1a1a]"
      >
        <div className={IMP_HEAD}>
          <h2 id={titleId} className="text-[15px] font-bold">
            Upload to List
          </h2>
          {step.kind === "preview" ? (
            <div className="text-xs text-[#6b7280]">
              {labelOf(tourType)} · {rows.length} row(s) ·{" "}
              {rows.length - dupIndexes.length} new · {dupIndexes.length}{" "}
              already in list
              {step.warning ? (
                <div className="mt-0.5 text-[#7C4A00]">⚠️ {step.warning}</div>
              ) : null}
            </div>
          ) : null}
          <label className={cn(IMP_CHECK_LABEL, "ml-auto")}>
            <input
              type="checkbox"
              checked={allForced}
              disabled={step.kind !== "preview" || inserting}
              onChange={(e) =>
                setForced(e.target.checked ? new Set(dupIndexes) : new Set())
              }
            />
            Insert anyway (all)
          </label>
        </div>

        {step.kind === "done" ? (
          <div className="flex flex-col gap-2 px-5 py-4 text-sm">
            <p className="font-medium">
              Inserted {step.result.inserted} order(s).
              {step.result.failed ? ` Failed: ${step.result.failed}.` : ""}
            </p>
            {step.result.errors?.length ? (
              <ul className="list-disc pl-5 text-[#A32D2D]">
                {step.result.errors.map((e, i) => (
                  <li key={i}>
                    {e.order_number || "(no order #)"}: {e.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 overflow-auto px-5">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {shown.map((c) => (
                    <th key={c.head} className={IMP_TH}>
                      {c.head}
                    </th>
                  ))}
                  <th className={IMP_TH}>Note</th>
                  <th className={IMP_TH} />
                </tr>
              </thead>
              <tbody>
                {step.kind === "reading"
                  ? messageRow("Reading file…", false)
                  : step.kind === "failed"
                    ? messageRow(step.message, true)
                    : rows.length === 0
                      ? messageRow("No rows found in this file.", false)
                      : rows.map((r, i) => (
                          <tr
                            key={i}
                            data-imp={r.order_number}
                            className={r.duplicate ? "bg-[#fff8e1]" : undefined}
                          >
                            {shown.map((c) => (
                              <td
                                key={c.head}
                                className={cn(
                                  IMP_TD,
                                  c.qtyText && "text-[11px] text-[#777]",
                                )}
                              >
                                {c.cell(r)}
                              </td>
                            ))}
                            <td className={IMP_TD}>
                              {r.duplicate ? (
                                <span className="inline-block rounded bg-[#F5C36B] px-[7px] py-0.5 text-[10px] font-bold whitespace-nowrap text-[#6b4708]">
                                  Already in list
                                </span>
                              ) : null}
                            </td>
                            <td className={IMP_TD}>
                              {r.duplicate ? (
                                <label className={IMP_CHECK_LABEL}>
                                  <input
                                    type="checkbox"
                                    checked={forced.has(i)}
                                    disabled={inserting}
                                    onChange={(e) =>
                                      toggle(i, e.target.checked)
                                    }
                                  />
                                  Insert anyway
                                </label>
                              ) : null}
                            </td>
                          </tr>
                        ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={IMP_FOOT}>
          {step.kind === "preview" ? (
            <span
              role={bad.length || commitError ? "alert" : undefined}
              className={cn(
                "text-xs",
                bad.length || commitError ? "text-[#A32D2D]" : "text-[#6b7280]",
              )}
            >
              {bad.length
                ? `Guest count not found in Quantities: ${bad.join(", ")}. Nothing can be inserted. Fix the quantity in Rezdy, download the CSV again and upload it.`
                : (commitError ?? `${selected} row(s) will be inserted`)}
            </span>
          ) : null}
          {step.kind === "done" ? (
            <button
              type="button"
              onClick={onClose}
              className={cn(IMP_PRIMARY, "ml-auto")}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={inserting || step.kind === "reading"}
                className={cn(IMP_SECONDARY, "ml-auto")}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (step.kind === "preview")
                    void insert(step.rows, step.warning);
                }}
                disabled={
                  step.kind !== "preview" ||
                  inserting ||
                  bad.length > 0 ||
                  selected === 0
                }
                className={IMP_PRIMARY}
              >
                {inserting ? "Inserting…" : "Insert"}
              </button>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

/** 旧页 `.imp-head` / `.imp-foot` / `.imp-table th, td` / `.select-all-wrap`。 */
const IMP_HEAD = "flex items-center gap-3 border-b border-[#e5e7eb] px-5 py-4";
const IMP_FOOT =
  "flex items-center gap-2.5 border-t border-[#e5e7eb] px-5 py-3.5";
const IMP_TH =
  "sticky top-0 border-b border-[#e5e7eb] bg-white px-1.5 py-2 text-left text-[11px] font-bold text-[#6b7280]";
const IMP_TD = "border-b border-[#f1f2f4] px-1.5 py-[7px]";
const IMP_CHECK_LABEL =
  "flex cursor-pointer items-center gap-1 text-[11px] whitespace-nowrap text-[#BA7517]";
/** 旧页面上传弹窗（.imp-foot）的两个按钮：Cancel 白底、确认蓝底。 */
const IMP_SECONDARY =
  "cursor-pointer rounded-[7px] border border-[#d3d1c7] bg-white px-3.5 py-[7px] text-[12px] text-[#444] disabled:cursor-not-allowed disabled:opacity-60";
const IMP_PRIMARY =
  "cursor-pointer rounded-[7px] border-none bg-[#378ADD] px-4 py-[7px] text-[12px] font-semibold text-white hover:bg-[#2b74c0] disabled:cursor-not-allowed disabled:opacity-60";
