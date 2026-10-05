"use client";

import { useRef, useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { commitTourImport, previewTourImport } from "@/lib/tour-tracking-api";
import { cn } from "@/lib/utils";
import type { TourImportResult, TourImportRow, TourTypeOption } from "@/types";

type Step =
  | { kind: "choose"; error: string | null }
  | { kind: "reading" }
  | { kind: "preview"; rows: TourImportRow[]; warning: string }
  | { kind: "inserting"; rows: TourImportRow[]; warning: string }
  | { kind: "done"; result: TourImportResult };

/** Rezdy CSV 才有 pax：算不出人数的行（整批不能插入，同旧页面）。 */
function badPax(rows: TourImportRow[]): string[] {
  return rows
    .filter((r) => r.pax !== undefined && !r.pax_ok)
    .map((r) => r.order_number);
}

/**
 * ⬆ Upload：把不是从本系统发出去的单补录进这天的列表。先选团，再选文件，预览后插入。
 * 只写库（状态 pending），**不发任何消息**。列表里已有的单默认跳过，可勾 Insert anyway（同旧页面）。
 */
export function TourUploadDialog({
  tourDate,
  tourTypes,
  onClose,
  onInserted,
  onUnauthorized,
}: {
  tourDate: string;
  tourTypes: TourTypeOption[];
  onClose: () => void;
  onInserted: () => void;
  onUnauthorized: () => void;
}) {
  const [tourType, setTourType] = useState("");
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  /** 勾了 Insert anyway 的已有单（按行号）。 */
  const [forced, setForced] = useState<Set<number>>(new Set());
  const [commitError, setCommitError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tourLabel =
    tourTypes.find((t) => t.key === tourType)?.label ?? tourType;

  async function readFile(file: File) {
    setStep({ kind: "reading" });
    setForced(new Set());
    setCommitError(null);
    try {
      const data = await previewTourImport({ file, tourDate, tourType });
      setStep({
        kind: "preview",
        rows: data.rows ?? [],
        warning: data.warning ?? "",
      });
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setStep({
        kind: "choose",
        error: `Upload failed: ${describeError(error)}`,
      });
    }
  }

  async function insert(rows: TourImportRow[], warning: string) {
    const selected = rows.filter((r, i) => !r.duplicate || forced.has(i));
    if (!selected.length || badPax(rows).length) return;
    setStep({ kind: "inserting", rows, warning });
    setCommitError(null);
    try {
      const result = await commitTourImport({
        rows: selected,
        tourDate,
        tourType,
      });
      setStep({ kind: "done", result });
      if (result.inserted) onInserted();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setCommitError(`Insert failed: ${describeError(error)}`);
      setStep({ kind: "preview", rows, warning });
    }
  }

  const titleId = "tour-upload-title";
  const busy = step.kind === "reading" || step.kind === "inserting";

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName={cn(
        "flex max-h-[90vh] flex-col overflow-hidden",
        step.kind === "preview" || step.kind === "inserting"
          ? "max-w-6xl"
          : "max-w-md",
      )}
    >
      <div className="border-b border-stone-200 px-5 py-3.5">
        <h2 id={titleId} className="text-base font-semibold text-stone-900">
          {step.kind === "choose" || step.kind === "reading"
            ? "Upload to List — Select Tour Type"
            : "Upload to List"}
        </h2>
        <p className="text-xs text-stone-500">
          Tour date {tourDate}. Adds orders that were not sent from this system.
          Nothing is sent to guests.
        </p>
      </div>

      {step.kind === "choose" || step.kind === "reading" ? (
        <>
          <div className="flex flex-col gap-3 px-5 py-4 text-sm">
            <select
              aria-label="Tour type"
              value={tourType}
              disabled={busy}
              onChange={(e) => setTourType(e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Select tour type —</option>
              {tourTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              aria-label="Manifest file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void readFile(file);
              }}
            />
            {step.kind === "choose" && step.error ? (
              <p
                role="alert"
                className="rounded-md bg-[#FCEBEB] px-3 py-2 text-[#A32D2D]"
              >
                {step.error}
              </p>
            ) : null}
            {step.kind === "reading" ? (
              <p className="text-stone-500">Reading file…</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!tourType || busy}
              onClick={() => fileRef.current?.click()}
              className={PRIMARY_BUTTON_CLASS}
            >
              Choose CSV / .xlsx file…
            </button>
          </div>
        </>
      ) : null}

      {step.kind === "preview" || step.kind === "inserting" ? (
        <Preview
          rows={step.rows}
          warning={step.warning}
          tourLabel={tourLabel}
          forced={forced}
          setForced={setForced}
          inserting={step.kind === "inserting"}
          error={commitError}
          onCancel={onClose}
          onInsert={() => void insert(step.rows, step.warning)}
        />
      ) : null}

      {step.kind === "done" ? (
        <>
          <div className="flex flex-col gap-2 px-5 py-4 text-sm">
            <p className="font-medium text-stone-800">
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
          <div className="flex justify-end border-t border-stone-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className={PRIMARY_BUTTON_CLASS}
            >
              Done
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function Preview({
  rows,
  warning,
  tourLabel,
  forced,
  setForced,
  inserting,
  error,
  onCancel,
  onInsert,
}: {
  rows: TourImportRow[];
  warning: string;
  tourLabel: string;
  forced: Set<number>;
  setForced: (next: Set<number>) => void;
  inserting: boolean;
  error: string | null;
  onCancel: () => void;
  onInsert: () => void;
}) {
  const dupIndexes = rows.flatMap((r, i) => (r.duplicate ? [i] : []));
  const selected = rows.filter((r, i) => !r.duplicate || forced.has(i)).length;
  const bad = badPax(rows);
  const csv = rows.some((r) => r.pax !== undefined);
  const allForced =
    dupIndexes.length > 0 && dupIndexes.every((i) => forced.has(i));

  function toggle(i: number, on: boolean) {
    const next = new Set(forced);
    if (on) next.add(i);
    else next.delete(i);
    setForced(next);
  }

  const TD = "px-3 py-1.5";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-5 py-2.5 text-xs text-stone-600">
        <div>
          {tourLabel} · {rows.length} row(s) · {rows.length - dupIndexes.length}{" "}
          new · {dupIndexes.length} already in list
          {warning ? (
            <div className="mt-0.5 text-amber-800">⚠️ {warning}</div>
          ) : null}
        </div>
        {dupIndexes.length ? (
          <label className="ml-auto inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={allForced}
              disabled={inserting}
              onChange={(e) =>
                setForced(e.target.checked ? new Set(dupIndexes) : new Set())
              }
            />
            Insert anyway (all)
          </label>
        ) : null}
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-stone-50">
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className={TD}>Order#</th>
              <th className={TD}>Name</th>
              <th className={TD}>Email</th>
              <th className={TD}>Phone</th>
              <th className={TD}>Qty</th>
              {csv ? <th className={TD}>Quantities</th> : null}
              <th className={TD}>MTLV</th>
              <th className={TD}>Pickup Time</th>
              <th className={TD}>Pickup Location</th>
              <th className={TD}>Note</th>
              <th className={TD} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-8 text-center text-stone-500"
                >
                  No rows found in this file.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={i}
                  data-imp={r.order_number}
                  className={cn(
                    "border-b border-stone-100",
                    r.duplicate && !forced.has(i) && "text-stone-400",
                  )}
                >
                  <td className={cn(TD, "font-semibold")}>{r.order_number}</td>
                  <td className={TD}>
                    {`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim()}
                  </td>
                  <td className={TD}>{r.email}</td>
                  <td className={TD}>{r.phone}</td>
                  <td className={TD}>
                    {r.pax === undefined ? (
                      String(r.quantities ?? "")
                    ) : r.pax_ok ? (
                      String(r.pax)
                    ) : (
                      <span className="font-bold text-[#A32D2D]">?</span>
                    )}
                  </td>
                  {csv ? (
                    <td className={cn(TD, "text-stone-500")}>{r.qty_label}</td>
                  ) : null}
                  <td className={TD}>{String(r.mtlv_promo ?? "")}</td>
                  <td className={TD}>{r.pickup_time}</td>
                  <td className={TD}>{r.pickup_location}</td>
                  <td className={TD}>
                    {r.duplicate ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold whitespace-nowrap text-amber-800">
                        Already in list
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    {r.duplicate ? (
                      <label className="inline-flex items-center gap-1 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={forced.has(i)}
                          disabled={inserting}
                          onChange={(e) => toggle(i, e.target.checked)}
                        />
                        Insert anyway
                      </label>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 px-5 py-3">
        <span
          role={bad.length || error ? "alert" : undefined}
          className={cn(
            "text-xs",
            bad.length || error
              ? "font-semibold text-[#A32D2D]"
              : "text-stone-500",
          )}
        >
          {bad.length
            ? `Guest count not found in Quantities: ${bad.join(", ")}. Nothing can be inserted. Fix the quantity in Rezdy, download the CSV again and upload it.`
            : (error ?? `${selected} row(s) will be inserted`)}
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={inserting}
          className={cn(SECONDARY_BUTTON_CLASS, "ml-auto")}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onInsert}
          disabled={inserting || bad.length > 0 || selected === 0}
          className={PRIMARY_BUTTON_CLASS}
        >
          {inserting ? "Inserting…" : "Insert"}
        </button>
      </div>
    </>
  );
}
