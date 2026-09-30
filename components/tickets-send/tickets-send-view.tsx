"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MessagePreviewPanel } from "@/components/ui/message-preview-panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { env } from "@/lib/env";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { chunk, SEND_BATCH_SIZE } from "@/lib/send-batches";
import {
  checkTicketsDuplicates,
  fetchTicketsMessagePreview,
  sendTicketsBatch,
} from "@/lib/tickets-send-api";
import type {
  TicketsGuest,
  TicketsManifestRow,
  TicketsSendResult,
  TicketsSendType,
} from "@/types";

import {
  filenameMatchesDate,
  MESSAGE_PREVIEW_TABS,
  sendTypeShort,
  toGuest,
  tourTypeLabel,
} from "./config";
import { ManifestPreview } from "./manifest-preview";
import { SendResults, type SendStop } from "./send-results";
import { UploadForm } from "./upload-form";

interface Batch {
  tourType: string;
  serviceDate: string;
  fileName: string;
  rows: TicketsManifestRow[];
}

type Step =
  | { kind: "form" }
  | { kind: "preview"; batch: Batch }
  | {
      kind: "sending" | "done";
      batch: Batch;
      sendType: TicketsSendType;
      guests: TicketsGuest[];
      /** 与 guests 前若干位一一对应（后端按请求顺序返回）。 */
      results: TicketsSendResult[];
      skippedDuplicates: number;
      stop: SendStop | null;
    };

type Dialog =
  | { kind: "filename-mismatch"; file: File }
  | { kind: "confirm-send"; guests: TicketsGuest[]; skippedDuplicates: number }
  | null;

export function TicketsSendView() {
  const [tourType, setTourType] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // 换文件后递增，让文件框清空（受控不了 <input type="file">）。
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [step, setStep] = useState<Step>({ kind: "form" });
  const [sendType, setSendType] = useState<TicketsSendType>("combined");
  // 重复单里勾了「照发」的行（按行号）。
  const [sendAnyway, setSendAnyway] = useState<ReadonlySet<number>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);

  const redirectingRef = useRef(false);
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 发送中离开页面会中断剩下的批次，先提示。
  const sending = step.kind === "sending";
  useEffect(() => {
    if (!sending) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sending]);

  function handleUpload() {
    setUploadError(null);
    if (!file) return setUploadError("Please select an Excel file.");
    if (!tourType) return setUploadError("Please select a tour type.");
    if (!serviceDate) return setUploadError("Please select a service date.");
    // 选错日期 = 整批发到错的一天（团期用的是页面上选的，不是 Excel 里的）。
    if (!filenameMatchesDate(file.name, serviceDate)) {
      setDialog({ kind: "filename-mismatch", file });
      return;
    }
    void upload(file);
  }

  async function upload(manifest: File) {
    setUploading(true);
    try {
      const data = await checkTicketsDuplicates(
        manifest,
        tourType,
        serviceDate,
      );
      // Excel 解析失败时后端返回 200 + error，不能当成空名单。
      if (data.error) {
        setUploadError(data.error);
      } else if (data.rows.length === 0) {
        setUploadError("No bookings found in this file.");
      } else {
        setSendAnyway(new Set());
        setSendType("combined");
        setStep({
          kind: "preview",
          batch: {
            tourType,
            serviceDate,
            fileName: manifest.name,
            rows: data.rows,
          },
        });
      }
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setUploadError(describeError(error));
    } finally {
      setUploading(false);
    }
  }

  function requestSend(batch: Batch) {
    const chosen = batch.rows.filter(
      (row, i) => !row.duplicate || sendAnyway.has(i),
    );
    setDialog({
      kind: "confirm-send",
      guests: chosen.map((row) =>
        toGuest(row, batch.tourType, batch.serviceDate),
      ),
      skippedDuplicates: batch.rows.length - chosen.length,
    });
  }

  /** 分小批依次发送；任何一批出错就停，不自动重试（那一批可能已经发出去了）。 */
  async function runSend(
    batch: Batch,
    guests: TicketsGuest[],
    skippedDuplicates: number,
  ) {
    const type = sendType;
    const results: TicketsSendResult[] = [];
    const base = {
      batch,
      sendType: type,
      guests,
      skippedDuplicates,
    } as const;
    setStep({ kind: "sending", ...base, results: [], stop: null });

    for (const group of chunk(guests, SEND_BATCH_SIZE)) {
      try {
        const response = await sendTicketsBatch(type, group);
        results.push(...response.results);
        setStep({
          kind: "sending",
          ...base,
          results: [...results],
          stop: null,
        });
      } catch (error) {
        if (isStatus(error, 401)) {
          // 401 在进后端之前就被挡下了，这一批确定没发。
          setStep({
            kind: "done",
            ...base,
            results,
            stop: { reason: "Your login expired.", uncertain: [] },
          });
          redirectToLogin();
          return;
        }
        setStep({
          kind: "done",
          ...base,
          results,
          stop: { reason: describeError(error), uncertain: group },
        });
        return;
      }
    }
    setStep({ kind: "done", ...base, results, stop: null });
  }

  function startOver() {
    setStep({ kind: "form" });
    setFile(null);
    setFileInputKey((k) => k + 1);
    setUploadError(null);
  }

  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Tickets Reminder
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">Send</h1>
          </div>
          <a
            href={`${env.legacyAdminBaseUrl}/admin/notifications/tickets-reminder/tracking`}
            className={SECONDARY_BUTTON_CLASS}
          >
            View Tracking
          </a>
        </header>

        {step.kind === "form" ? (
          <div className="flex max-w-3xl flex-col gap-5">
            <UploadForm
              tourType={tourType}
              serviceDate={serviceDate}
              fileInputKey={fileInputKey}
              uploading={uploading}
              error={uploadError}
              onTourTypeChange={setTourType}
              onServiceDateChange={setServiceDate}
              onFileChange={setFile}
              onSubmit={handleUpload}
            />
            <MessagePreviewPanel
              tabs={MESSAGE_PREVIEW_TABS}
              loadKey={`${tourType}|${serviceDate}`}
              load={
                tourType && serviceDate
                  ? (signal) =>
                      fetchTicketsMessagePreview(tourType, serviceDate, signal)
                  : null
              }
              idleText="Select a tour type and service date above to preview the message content."
            />
          </div>
        ) : null}

        {step.kind === "preview" ? (
          <ManifestPreview
            batch={step.batch}
            tourLabel={tourTypeLabel(step.batch.tourType)}
            sendAnyway={sendAnyway}
            onSendAnywayChange={setSendAnyway}
            sendType={sendType}
            onSendTypeChange={setSendType}
            onSend={() => requestSend(step.batch)}
            onStartOver={startOver}
          />
        ) : null}

        {step.kind === "sending" || step.kind === "done" ? (
          <SendResults
            sending={step.kind === "sending"}
            tourLabel={tourTypeLabel(step.batch.tourType)}
            serviceDate={step.batch.serviceDate}
            sendType={step.sendType}
            guests={step.guests}
            results={step.results}
            skippedDuplicates={step.skippedDuplicates}
            stop={step.stop}
            onStartOver={startOver}
          />
        ) : null}
      </div>

      {dialog?.kind === "filename-mismatch" ? (
        <ConfirmDialog
          title="Filename / date mismatch"
          confirmLabel="Proceed anyway"
          busyLabel="Uploading…"
          onClose={closeDialog}
          onConfirm={async (): Promise<ActionResult> => {
            setDialog(null);
            void upload(dialog.file);
            return { status: "ok" };
          }}
        >
          <p>
            Service date selected: <b>{serviceDate}</b>
          </p>
          <p className="break-all">
            Filename: <b>{dialog.file.name}</b>
          </p>
          <p>
            The filename does not contain this date. Every guest in the file
            will be sent the reminder for {serviceDate}.
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "confirm-send" && step.kind === "preview" ? (
        <ConfirmDialog
          title="Send reminders?"
          confirmLabel={`Send to ${dialog.guests.length} guest${dialog.guests.length === 1 ? "" : "s"}`}
          busyLabel="Starting…"
          onClose={closeDialog}
          onConfirm={async (): Promise<ActionResult> => {
            const { guests, skippedDuplicates } = dialog;
            setDialog(null);
            void runSend(step.batch, guests, skippedDuplicates);
            return { status: "ok" };
          }}
        >
          <p>
            <b>{dialog.guests.length}</b> guest
            {dialog.guests.length === 1 ? "" : "s"} will get the{" "}
            <b>{tourTypeLabel(step.batch.tourType)}</b> reminder for{" "}
            <b>{step.batch.serviceDate}</b> by <b>{sendTypeShort(sendType)}</b>.
          </p>
          {dialog.skippedDuplicates > 0 ? (
            <p>
              {dialog.skippedDuplicates} duplicate
              {dialog.skippedDuplicates === 1 ? "" : "s"} will be skipped.
            </p>
          ) : null}
          <p>Messages go out to real guests and cannot be recalled.</p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}
