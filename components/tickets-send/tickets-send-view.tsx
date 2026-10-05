"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MessagePreviewPanel } from "@/components/ui/message-preview-panel";
import type { ApplyState } from "@/components/ui/upload-compare-panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { chunk, SEND_BATCH_SIZE } from "@/lib/send-batches";
import {
  applyTicketsUpload,
  checkTicketsDuplicates,
  fetchTicketsMessagePreview,
  sendTicketsBatch,
  startTicketsBatch,
} from "@/lib/tickets-send-api";
import type {
  TicketsGuest,
  TicketsManifestRow,
  TicketsRemovedOrder,
  TicketsSendResult,
  TicketsSendType,
  TicketsSkipped,
} from "@/types";

import {
  blockReasons,
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
  /** 预览时的服务器时间，发送时原样带回（Send anyway 只对这之前发过的单生效）。 */
  previewAt: string;
  conflicts: string[];
  warning: string;
  /** 这个团期已有订单（重新上传）时才有：比对结果。 */
  compare: { removed: TicketsRemovedOrder[] } | null;
}

type Step =
  | { kind: "form" }
  | { kind: "preview"; batch: Batch }
  | {
      kind: "sending" | "done";
      batch: Batch;
      sendType: TicketsSendType;
      guests: TicketsGuest[];
      /** 发出去的（后端跳过的不在里面，按 chd_number 对回客人）。 */
      results: TicketsSendResult[];
      /** 页面自己没送去的（已发过没勾 Send anyway、文件里第二次出现）+ 服务端发前查重跳过的。 */
      skipped: TicketsSkipped[];
      /** 已经有结果的客人数（发了的 + 服务端跳过的），进度和「没发」从这里算。 */
      processed: number;
      stop: SendStop | null;
      /** 这一次点 Send 的批次（Send Log 里按批看）。 */
      batchId: number | null;
    };

type Dialog =
  | { kind: "filename-mismatch"; file: File }
  | {
      kind: "confirm-send";
      guests: TicketsGuest[];
      held: TicketsSkipped[];
      sendAnyway: string[];
    }
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
  const [apply, setApply] = useState<ApplyState>({ kind: "idle" });

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
    if (!file)
      return setUploadError("Please select a manifest file (.csv or .xlsx).");
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
        setApply({ kind: "idle" });
        setStep({
          kind: "preview",
          batch: {
            tourType,
            serviceDate,
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
      }
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setUploadError(describeError(error));
    } finally {
      setUploading(false);
    }
  }

  /** Apply：Added / Changed 存进系统，不发任何消息（同旧页面）。 */
  async function applyUpload(batch: Batch) {
    if (apply.kind === "saving") return;
    if (blockReasons(batch.rows, batch.conflicts).length) return;
    const toApply = batch.rows.filter(
      (r) => r.upload_status === "added" || r.upload_status === "changed",
    );
    if (!toApply.length) return;
    setApply({ kind: "saving" });
    try {
      const result = await applyTicketsUpload(
        batch.serviceDate,
        batch.tourType,
        toApply.map((r) => toGuest(r, batch.tourType, batch.serviceDate)),
      );
      // 存好了：这些行现在和系统一样。
      const rows = batch.rows.map((r) =>
        toApply.includes(r)
          ? { ...r, upload_status: "unchanged" as const, changes: [] }
          : r,
      );
      setStep({ kind: "preview", batch: { ...batch, rows } });
      setApply({
        kind: "saved",
        message: `Saved: ${result.updated} updated, ${result.added} added. Nothing was sent.`,
      });
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
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

  function requestSend(batch: Batch) {
    if (blockReasons(batch.rows, batch.conflicts).length) return;
    // 文件里第二次出现的同一单不发；已发过的只有勾了 Send anyway 才发。
    const chosen: TicketsManifestRow[] = [];
    const held: TicketsSkipped[] = [];
    batch.rows.forEach((row, i) => {
      if (!row.listed_twice && (!row.duplicate || sendAnyway.has(i))) {
        chosen.push(row);
      } else {
        held.push({
          chd_number: row.order_number,
          name: row.name,
          message: row.listed_twice
            ? "Listed twice in this file"
            : "Already sent for this date and tour",
        });
      }
    });
    setDialog({
      kind: "confirm-send",
      guests: chosen.map((row) =>
        toGuest(row, batch.tourType, batch.serviceDate),
      ),
      held,
      sendAnyway: chosen.filter((r) => r.duplicate).map((r) => r.order_number),
    });
  }

  /**
   * 先建一批（什么都不发，建不成就不发，同旧页面），再分小批依次发送；任何一批出错就停，
   * 不自动重试、不让再点发送（那一批可能已经发出去了）。
   * 服务端发前还会再查一次重，所以就算重试也不会重复发——但 staff 应先看 Send Log。
   */
  async function runSend(
    batch: Batch,
    guests: TicketsGuest[],
    held: TicketsSkipped[],
    anyway: string[],
  ): Promise<ActionResult> {
    const type = sendType;
    let batchId: number;
    try {
      batchId = (
        await startTicketsBatch({
          tour_type: batch.tourType,
          service_date: batch.serviceDate,
          send_type: type,
          file_rows: batch.rows.length,
          held,
        })
      ).batch_id;
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
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
    const results: TicketsSendResult[] = [];
    const skipped: TicketsSkipped[] = [...held];
    let processed = 0;
    const base = { batch, sendType: type, guests } as const;
    const snapshot = (stop: SendStop | null, kind: "sending" | "done") =>
      setStep({
        kind,
        ...base,
        results: [...results],
        skipped: [...skipped],
        processed,
        stop,
        batchId,
      });
    snapshot(null, "sending");

    for (const group of chunk(guests, SEND_BATCH_SIZE)) {
      try {
        const response = await sendTicketsBatch(
          type,
          group,
          anyway,
          batch.previewAt,
          batchId,
        );
        results.push(...response.results);
        skipped.push(...(response.skipped ?? []));
        processed += group.length;
        snapshot(null, "sending");
      } catch (error) {
        if (isStatus(error, 401)) {
          // 401 在进后端之前就被挡下了，这一批确定没发。
          snapshot({ reason: "Your login expired.", uncertain: [] }, "done");
          redirectToLogin();
          return { status: "ok" };
        }
        // 400：服务端在发第一条之前整批拒了，这一批确定没发。
        const rejected = isStatus(error, 400);
        snapshot(
          {
            reason: describeError(error),
            uncertain: rejected ? [] : group,
            maybeSent: !rejected,
          },
          "done",
        );
        return { status: "ok" };
      }
    }
    snapshot(null, "done");
    return { status: "ok" };
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
          <Link
            href="/tickets-reminder/tracking"
            className={SECONDARY_BUTTON_CLASS}
          >
            View Tracking
          </Link>
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
            <HowToUse />
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
            apply={apply}
            onApply={() => void applyUpload(step.batch)}
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
            skipped={step.skipped}
            processed={step.processed}
            stop={step.stop}
            batchId={step.batchId}
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
          onConfirm={() =>
            runSend(step.batch, dialog.guests, dialog.held, dialog.sendAnyway)
          }
        >
          <p>
            <b>{dialog.guests.length}</b> guest
            {dialog.guests.length === 1 ? "" : "s"} will get the{" "}
            <b>{tourTypeLabel(step.batch.tourType)}</b> reminder for{" "}
            <b>{step.batch.serviceDate}</b> by <b>{sendTypeShort(sendType)}</b>.
          </p>
          {dialog.held.length > 0 ? (
            <p>
              {dialog.held.length} will be skipped (already sent or listed twice
              in this file).
            </p>
          ) : null}
          {dialog.sendAnyway.length > 0 ? (
            <p>
              Send anyway: {dialog.sendAnyway.join(", ")} will be sent once
              more. Sending again later does not send them a third time.
            </p>
          ) : null}
          <p>Messages go out to real guests and cannot be recalled.</p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

function HowToUse() {
  return (
    <details className="rounded-lg border border-[#d4e6c3] bg-[#f7f9f5] px-5 py-4 text-sm leading-relaxed text-[#4a5a3a]">
      <summary className="cursor-pointer font-semibold text-[#3B6D11]">
        📖 How to use — Tickets Reminder
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Select the Tour Type and the Service Date above.</li>
        <li>
          Download the manifest from Rezdy. A CSV works: upload it as is and do
          not open it in Excel first. An .xlsx file still works. The filename
          should contain the service date.
        </li>
        <li>Click Upload &amp; Preview to review the list before sending.</li>
        <li>
          For a CSV, Qty shows the guest count and the ticket types under it.
          Check they match.
        </li>
        <li>
          If a row shows ? in Qty and turns red, the guest count was not found
          and nothing can be sent. Fix the quantity in Rezdy, download the CSV
          again and upload it.
        </li>
        <li>
          Orders already sent for this date and tour are marked Duplicate and
          skipped. Tick Send anyway to send them again. Send anyway sends an
          order once: clicking Send again does not send it a second time.
        </li>
        <li>
          If an order is in the file twice with the same details, the second row
          is marked Listed twice in this file and the guest gets one message. If
          the two rows have different details, nothing can be sent: check the
          order in Rezdy, download the file again and upload it.
        </li>
        <li>
          If a row has no order number, nothing can be sent. Add the order
          number in the file, or remove the row, and upload it again.
        </li>
        <li>
          If this tour and date already have orders in the system, a blue box
          above the list shows Added, Removed and Changed orders, with the old
          and new values. Click Apply to save the new file. Apply does not send
          anything.
        </li>
        <li>
          Removed orders are not in the new file. They stay in the list, crossed
          out, and no message is sent to them. Contact the guest yourself if
          needed.
        </li>
        <li>
          If a yellow note says the CSV is not saved as UTF-8, check the names
          in the list. If they look wrong, download the CSV from Rezdy again and
          upload it without opening it.
        </li>
        <li>
          Choose SMS + Email, SMS Only, or Email Only, then click Send. A bar
          shows how many have been done. Keep the page open until Send Results
          appears.
        </li>
        <li>
          Send Results shows Sent, Failed and Skipped. Skipped orders were
          already sent or listed twice, and the list says which.
        </li>
      </ol>
      <p className="mt-3 border-t border-[#d4e6c3] pt-3">
        ⚠️ If the page says the reminders may already have been sent, do not
        send again yet. Open the Send Log and check which orders were sent. To
        send the rest, click Send Another and upload the file again: orders
        already sent are marked Duplicate and skipped. If anything else goes
        wrong, take a screenshot and notify Annie.
      </p>
    </details>
  );
}
