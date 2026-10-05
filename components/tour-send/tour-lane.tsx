"use client";

import { useCallback, useEffect, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ApplyState } from "@/components/ui/upload-compare-panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { chunk, SEND_BATCH_SIZE } from "@/lib/send-batches";
import {
  applyTourUpload,
  previewTourManifest,
  sendTourGroup,
  startTourBatch,
} from "@/lib/tour-send-api";
import { cn } from "@/lib/utils";
import type {
  TourGuest,
  TourHeld,
  TourLane,
  TourSendResult,
  TourSendType,
  TourSkipped,
  TourTypeOption,
} from "@/types";

import {
  blockReasons,
  filenameProblems,
  LANES,
  sendTypeShort,
  toGuest,
} from "./config";
import { type TourBatch, TourPreview } from "./tour-preview";
import { TourResults, type TourSendStop } from "./tour-results";

type Step =
  | { kind: "form" }
  | { kind: "preview"; batch: TourBatch }
  | {
      kind: "sending" | "done";
      batch: TourBatch;
      sendType: TourSendType;
      guests: TourGuest[];
      results: TourSendResult[];
      /** 页面自己留下的 + 服务端发前查重跳过的。 */
      skipped: TourSkipped[];
      /** 已经有结果的客人数（发了的 + 服务端跳过的）。 */
      processed: number;
      stop: TourSendStop | null;
      batchId: number | null;
    };

type Dialog =
  | { kind: "filename"; file: File; slug: boolean; date: boolean }
  | { kind: "confirm"; guests: TourGuest[]; held: TourHeld[]; anyway: string[] }
  | null;

const INPUT =
  "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

/**
 * 发送页的一块（团确认 / Last Minute）：选团、日期、上传 → 预览（比对 / Apply）→ 分小批发送 → 结果。
 * 两块各自独立，同旧页面。
 */
export function TourLaneSection({
  lane,
  tourTypes,
  tourTypesError,
  onUnauthorized,
  onSendingChange,
  onSelectionChange,
  children,
}: {
  lane: TourLane;
  tourTypes: TourTypeOption[] | null;
  tourTypesError: string | null;
  onUnauthorized: () => void;
  /** 发送中（页面据此提醒别离开）。 */
  onSendingChange: (sending: boolean) => void;
  /** 团 + 日期变了（Regular 那一块的消息预览跟着它）。 */
  onSelectionChange?: (tourType: string, tourDate: string) => void;
  /** 表单下面的东西（消息预览、How to use），只在表单那一步显示。 */
  children?: React.ReactNode;
}) {
  const cfg = LANES[lane];
  const [tourType, setTourType] = useState("");
  const [tourDate, setTourDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [sendType, setSendType] = useState<TourSendType>("combined");
  const [sendAnyway, setSendAnyway] = useState<ReadonlySet<number>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [apply, setApply] = useState<ApplyState>({ kind: "idle" });

  const sending = step.kind === "sending";
  useEffect(() => onSendingChange(sending), [sending, onSendingChange]);

  const option = tourTypes?.find((t) => t.key === tourType);
  const labelOf = useCallback(
    (key: string) => tourTypes?.find((t) => t.key === key)?.label ?? key,
    [tourTypes],
  );

  function pickType(v: string) {
    setTourType(v);
    onSelectionChange?.(v, tourDate);
  }
  function pickDate(v: string) {
    setTourDate(v);
    onSelectionChange?.(tourType, v);
  }

  function handleUpload() {
    setUploadError(null);
    if (!file) return setUploadError("Please select a CSV or Excel file.");
    if (!tourType) return setUploadError("Please select a tour type.");
    if (!tourDate) return setUploadError("Please select a tour date.");
    const p = filenameProblems(file.name, option, tourDate);
    if (p.slug || p.date) {
      setDialog({ kind: "filename", file, ...p });
      return;
    }
    void upload(file);
  }

  async function upload(manifest: File) {
    setUploading(true);
    try {
      const data = await previewTourManifest(
        manifest,
        tourType,
        tourDate,
        lane,
      );
      if (!data.rows.length) {
        setUploadError("No bookings found in this file.");
        return;
      }
      setSendAnyway(new Set());
      setSendType("combined");
      setApply({ kind: "idle" });
      setStep({
        kind: "preview",
        batch: {
          lane,
          tourType,
          tourLabel: labelOf(tourType),
          tourDate,
          fileName: manifest.name,
          rows: data.rows,
          previewAt: data.preview_at ?? "",
          conflicts: data.listed_twice_conflicts ?? [],
          warning: data.warning ?? "",
          compare: data.compare?.reupload
            ? { removed: data.compare.removed ?? [] }
            : null,
        },
      });
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else
        setUploadError(
          error instanceof TypeError
            ? "Network error. Please try again."
            : describeError(error),
        );
    } finally {
      setUploading(false);
    }
  }

  /** Apply：Added / Changed 存进系统，不发任何消息（同旧页面）。 */
  async function applyUpload(batch: TourBatch) {
    if (
      apply.kind === "saving" ||
      blockReasons(batch.rows, batch.conflicts).length
    )
      return;
    const toApply = batch.rows.filter(
      (r) => r.upload_status === "added" || r.upload_status === "changed",
    );
    if (!toApply.length) return;
    setApply({ kind: "saving" });
    try {
      const res = await applyTourUpload({
        tour_type: batch.tourType,
        tour_date: batch.tourDate,
        lane: cfg.applyLane,
        guests: toApply.map(toGuest),
      });
      // 存好了：这些行现在和系统一样。已勾的 Send anyway 照旧（按行号，行没变）。
      const rows = batch.rows.map((r) =>
        toApply.includes(r)
          ? { ...r, upload_status: "unchanged" as const, changes: [] }
          : r,
      );
      setStep({ kind: "preview", batch: { ...batch, rows } });
      setApply({
        kind: "saved",
        message: `Saved: ${res.updated} updated, ${res.added} added. Nothing was sent.`,
      });
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setApply({
        kind: "error",
        message:
          error instanceof TypeError
            ? "Network error. Nothing was saved. Try Apply again."
            : `${describeError(error)} Nothing was saved.`,
      });
    }
  }

  function requestSend(batch: TourBatch) {
    if (blockReasons(batch.rows, batch.conflicts).length) return;
    // 文件里第二次出现的同一单不发；已发过的只有勾了 Send anyway 才发（同旧页面）。
    const chosen: TourBatch["rows"] = [];
    const held: TourHeld[] = [];
    batch.rows.forEach((r, i) => {
      if (!r.listed_twice && (!r.duplicate || sendAnyway.has(i)))
        chosen.push(r);
      else
        held.push({
          order: r.order_number,
          order_number: r.order_number,
          name: r.name,
          message: r.listed_twice
            ? "Listed twice in this file"
            : "Already sent for this date and tour",
        });
    });
    setDialog({
      kind: "confirm",
      guests: chosen.map(toGuest),
      held,
      anyway: chosen
        .filter((r) => r.duplicate)
        .map((r) => String(r.order_number)),
    });
  }

  /**
   * 先建一批（什么都不发，建不成就不发），再每 10 位一个请求依次发；任何一组出错就停，
   * 不自动重试、不让再点发送（那一组可能已经发出去了）。服务端发前拿锁再查重，所以重来也不会多发。
   */
  async function runSend(
    batch: TourBatch,
    guests: TourGuest[],
    held: TourHeld[],
    anyway: string[],
  ): Promise<ActionResult> {
    const type = sendType;
    let batchId: number;
    try {
      batchId = (
        await startTourBatch({
          lane,
          tour_type: batch.tourType,
          tour_date: batch.tourDate,
          send_type: type,
          file_rows: batch.rows.length,
          held,
        })
      ).batch_id;
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return { status: "redirecting" };
      }
      return {
        status: "error",
        message:
          error instanceof TypeError
            ? "Could not reach the server. Nothing was sent. Please try again in a minute."
            : `Could not start the send: ${describeError(error)} Nothing was sent.`,
      };
    }
    setDialog(null);

    const results: TourSendResult[] = [];
    const skipped: TourSkipped[] = [...held];
    let processed = 0;
    const snap = (stop: TourSendStop | null, kind: "sending" | "done") =>
      setStep({
        kind,
        batch,
        sendType: type,
        guests,
        results: [...results],
        skipped: [...skipped],
        processed,
        stop,
        batchId,
      });
    snap(null, "sending");

    for (const group of chunk(guests, SEND_BATCH_SIZE)) {
      try {
        const res = await sendTourGroup(lane, {
          tour_type: batch.tourType,
          tour_date: batch.tourDate,
          send_type: type,
          guests: group,
          send_anyway: anyway,
          preview_at: batch.previewAt,
          batch_id: batchId,
        });
        results.push(...(res.results ?? []));
        skipped.push(...(res.skipped ?? []));
        processed += group.length;
        snap(null, "sending");
      } catch (error) {
        if (isStatus(error, 401)) {
          // 401 在进后端之前就被挡下了，这一组确定没发。
          snap({ reason: "Your login expired.", uncertain: [] }, "done");
          onUnauthorized();
          return { status: "ok" };
        }
        // 400：服务端在发第一条之前整组拒了，这一组确定没发。
        const rejected = isStatus(error, 400);
        snap(
          {
            reason:
              error instanceof TypeError
                ? "Could not reach the server."
                : describeError(error),
            uncertain: rejected ? [] : group,
            maybeSent: !rejected,
          },
          "done",
        );
        return { status: "ok" };
      }
    }
    snap(null, "done");
    return { status: "ok" };
  }

  function reset() {
    setStep({ kind: "form" });
    setFile(null);
    setFileKey((k) => k + 1);
    setUploadError(null);
  }

  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <div className="flex flex-col gap-4" data-lane={lane}>
      {step.kind === "form" ? (
        <>
          <form
            noValidate
            aria-label={cfg.title}
            onSubmit={(e) => {
              e.preventDefault();
              handleUpload();
            }}
            className="flex max-w-3xl flex-col gap-4 rounded-lg border border-stone-200 bg-white p-5"
          >
            <h2 className="text-base font-semibold text-stone-900">
              {cfg.title}
            </h2>
            {lane === "last_minute" ? (
              <p className="-mt-2 text-xs font-semibold text-[#c0392b]">
                For orders placed within the cancellation window, or after 6 PM
                the day before the tour — skip reconfirmation; send directly to
                lunch selection &amp; pickup details.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-4">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
                Tour Type
                <select
                  value={tourType}
                  disabled={!tourTypes}
                  onChange={(e) => pickType(e.target.value)}
                  className={INPUT}
                >
                  <option value="">
                    {tourTypes ? "— Select tour type —" : "Loading tour types…"}
                  </option>
                  {(tourTypes ?? []).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
                Tour Date
                <input
                  type="date"
                  value={tourDate}
                  onChange={(e) => pickDate(e.target.value)}
                  className={INPUT}
                />
              </label>
            </div>
            {tourTypesError ? (
              <p role="alert" className="text-sm text-[#A32D2D]">
                Could not load the tour types: {tourTypesError} Reload the page
                to try again.
              </p>
            ) : null}
            <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
              Manifest (.csv or .xlsx)
              <input
                key={fileKey}
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className={INPUT}
              />
            </label>
            <p className="text-xs text-stone-400">
              Required columns: Order Number, First Name, Last Name, Email,
              Customer Phone, Pick-up Time, Pick-up Location
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={uploading || !tourTypes}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60",
                  cfg.accent,
                  cfg.accentHover,
                )}
              >
                {uploading
                  ? "Uploading…"
                  : lane === "last_minute"
                    ? "⚡ Upload & Preview"
                    : "📂 Upload & Preview"}
              </button>
              <span className="text-xs text-stone-500">
                Nothing is sent at this step.
              </span>
            </div>
            {uploadError ? (
              <p role="alert" className="text-sm text-[#A32D2D]">
                {uploadError}
              </p>
            ) : null}
          </form>
          {children}
        </>
      ) : null}

      {step.kind === "preview" ? (
        <TourPreview
          batch={step.batch}
          sendAnyway={sendAnyway}
          onSendAnywayChange={setSendAnyway}
          sendType={sendType}
          onSendTypeChange={setSendType}
          onSend={() => requestSend(step.batch)}
          onCancel={reset}
          apply={apply}
          onApply={() => void applyUpload(step.batch)}
        />
      ) : null}

      {step.kind === "sending" || step.kind === "done" ? (
        <TourResults
          lane={lane}
          sending={step.kind === "sending"}
          tourLabel={step.batch.tourLabel}
          tourDate={step.batch.tourDate}
          sendType={step.sendType}
          guests={step.guests}
          results={step.results}
          skipped={step.skipped}
          processed={step.processed}
          stop={step.stop}
          batchId={step.batchId}
          onStartOver={reset}
        />
      ) : null}

      {dialog?.kind === "filename" ? (
        <ConfirmDialog
          title="Filename mismatch"
          confirmLabel="Proceed anyway"
          busyLabel="Uploading…"
          onClose={closeDialog}
          onConfirm={async (): Promise<ActionResult> => {
            setDialog(null);
            void upload(dialog.file);
            return { status: "ok" };
          }}
        >
          {dialog.slug ? (
            <p>
              Tour selected: <b>{labelOf(tourType)}</b>
              {option?.file_slug ? (
                <>
                  {" "}
                  (file names usually contain <b>{option.file_slug}</b>)
                </>
              ) : null}
            </p>
          ) : null}
          {dialog.date ? (
            <p>
              Date selected: <b>{tourDate}</b>
            </p>
          ) : null}
          <p className="break-all">
            Filename: <b>{dialog.file.name}</b>
          </p>
          <p>
            Every guest in the file will get the message for the tour and date
            selected above.
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "confirm" && step.kind === "preview" ? (
        <ConfirmDialog
          title={
            lane === "last_minute"
              ? "Send Last Minute?"
              : "Send tour confirmations?"
          }
          confirmLabel={`Send to ${dialog.guests.length} order${dialog.guests.length === 1 ? "" : "s"}`}
          busyLabel="Starting…"
          onClose={closeDialog}
          onConfirm={() =>
            runSend(step.batch, dialog.guests, dialog.held, dialog.anyway)
          }
        >
          <p>
            <b>{dialog.guests.length}</b> order
            {dialog.guests.length === 1 ? "" : "s"} will get the{" "}
            {lane === "last_minute" ? "Last Minute " : ""}
            <b>{step.batch.tourLabel}</b> message for{" "}
            <b>{step.batch.tourDate}</b> by <b>{sendTypeShort(sendType)}</b>.
          </p>
          {dialog.held.length > 0 ? (
            <p>
              {dialog.held.length} will be skipped (already sent or listed twice
              in this file).
            </p>
          ) : null}
          {dialog.anyway.length > 0 ? (
            <p>
              Send anyway: {dialog.anyway.join(", ")} will be sent once more.
              Sending again later does not send them a third time.
            </p>
          ) : null}
          <p>Messages go out to real guests and cannot be recalled.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
