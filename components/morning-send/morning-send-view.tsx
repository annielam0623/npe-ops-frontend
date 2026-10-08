"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FORM_GROUP,
  FORM_HINT,
  FORM_ROW,
  INLINE_ERROR,
  inputClass,
  SEND_CARD,
  SEND_CARD_TITLE,
  SendHowTo,
  SendPageHeader,
  sendButtonClass,
  TrackingButton,
} from "@/components/tickets-send/legacy-ui";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MessagePreviewPanel } from "@/components/ui/message-preview-panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchMorningMessagePreview,
  previewMorningManifest,
  sendMorningBatch,
} from "@/lib/morning-send-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { chunk, SEND_BATCH_SIZE } from "@/lib/send-batches";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import type {
  MorningManifestRow,
  MorningSendResult,
  MorningSendType,
} from "@/types";

import {
  DEFAULT_SEND_TYPE,
  MESSAGE_PREVIEW_TABS,
  sendTypeShort,
} from "./config";
import { MorningPreviewStep } from "./morning-preview";
import { MorningResults, type MorningSendStop } from "./morning-results";

interface Manifest {
  /** 发送时要把同一个文件再传给后端（后端按文件重新解析）。 */
  file: File;
  rows: MorningManifestRow[];
  /** 预览接口给的服务器时间，每一批原样带回（Send anyway 只认这一刻之前发出去的单）。 */
  previewAt: string;
}

type Step =
  | { kind: "form" }
  | { kind: "preview"; manifest: Manifest }
  | {
      kind: "sending" | "done";
      manifest: Manifest;
      sendType: MorningSendType;
      orders: string[];
      results: MorningSendResult[];
      stop: MorningSendStop | null;
    };

/** 选中的单里人数算不出的（只有 Rezdy CSV 的行有 pax_ok）：有一个就整批不能发，同服务端只查要发的单（后端 2026-10-06）。 */
export function badPaxOrders(
  rows: readonly MorningManifestRow[],
  selected: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      rows
        .filter((r) => r.pax_ok === false && selected.has(r.order_number))
        .map((r) => r.order_number || "?"),
    ),
  ];
}

/** 按文件顺序列出选中的订单号，去重。 */
function selectedInFileOrder(
  rows: readonly MorningManifestRow[],
  selected: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (selected.has(row.order_number) && !seen.has(row.order_number)) {
      seen.add(row.order_number);
      out.push(row.order_number);
    }
  }
  return out;
}

export function MorningSendView() {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [step, setStep] = useState<Step>({ kind: "form" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sendType, setSendType] = useState<MorningSendType>(DEFAULT_SEND_TYPE);
  const [confirming, setConfirming] = useState(false);

  const redirectingRef = useRef(false);
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 离开页面后不再发下一批：剩下的批次留在后台发，staff 看不到结果、容易再传再发。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 发送中离开页面（关标签、刷新、点侧栏、浏览器后退）先问。
  useLeaveGuard(
    step.kind === "sending",
    "Messages are still being sent. Leave this page anyway? You will not see the results.",
  );

  async function handleUpload() {
    setUploadError(null);
    if (!file) {
      setUploadError("Please select a .csv or .xlsx file.");
      return;
    }
    setUploading(true);
    try {
      const data = await previewMorningManifest(file);
      if (data.rows.length === 0) {
        setUploadError("No bookings found in this file.");
        return;
      }
      // 默认勾选 = 今天还没发过的全部；已发过的一个都不勾。
      setSelected(
        new Set(
          data.rows.filter((r) => !r.duplicate).map((r) => r.order_number),
        ),
      );
      setSendType(DEFAULT_SEND_TYPE);
      setStep({
        kind: "preview",
        manifest: { file, rows: data.rows, previewAt: data.preview_at ?? "" },
      });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setUploadError(describeError(error));
    } finally {
      setUploading(false);
    }
  }

  /** 分小批依次发送；任何一批出错就停，不自动重试（那一批可能已经发出去了）。 */
  async function runSend(manifest: Manifest, orders: string[]) {
    const type = sendType;
    const results: MorningSendResult[] = [];
    const base = { manifest, sendType: type, orders } as const;
    // 下面那块（今天发过）里勾中的 = Send anyway。
    const alreadySent = new Set(
      manifest.rows.filter((r) => r.duplicate).map((r) => r.order_number),
    );
    setStep({ kind: "sending", ...base, results: [], stop: null });

    for (const group of chunk(orders, SEND_BATCH_SIZE)) {
      if (!mountedRef.current) return;
      try {
        const response = await sendMorningBatch(manifest.file, type, group, {
          sendAnyway: group.filter((o) => alreadySent.has(o)),
          previewAt: manifest.previewAt,
        });
        // 后端对文件里每一行都返回一条：没选中的是 skipped、没有 reason，不列；
        // 服务端查重跳过的（Already sent today / Listed twice in this file）带 reason，列出来。
        results.push(...response.results.filter((r) => !r.skipped || r.reason));
        setStep({
          kind: "sending",
          ...base,
          results: [...results],
          stop: null,
        });
      } catch (error) {
        if (isStatus(error, 401)) {
          setStep({
            kind: "done",
            ...base,
            results,
            stop: { reason: "Your login expired.", uncertain: [] },
          });
          redirectToLogin();
          return;
        }
        // 400：后端在发第一条之前就拒了（文件解析不了 / 人数算不出），这一批确定没发。
        // 网络错误不用 describeError 的「Please try again」：这里正叫人先查 Send Log 别重发。
        setStep({
          kind: "done",
          ...base,
          results,
          stop: {
            reason:
              error instanceof TypeError
                ? "Could not reach the server."
                : describeError(error),
            uncertain: isStatus(error, 400) ? [] : group,
          },
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
    setSelected(new Set());
    setSendType(DEFAULT_SEND_TYPE);
  }

  const closeConfirm = useCallback(() => setConfirming(false), []);

  const pendingOrders =
    step.kind === "preview"
      ? selectedInFileOrder(step.manifest.rows, selected)
      : [];
  const resendCount =
    step.kind === "preview"
      ? step.manifest.rows.filter(
          (r) => r.duplicate && selected.has(r.order_number),
        ).length
      : 0;

  return (
    <main className="text-stone-800">
      <TrackingButton href="/morning-pickup/tracking" color="bg-[#185FA5]" />
      <SendPageHeader title="Morning Pickup — Send" />

      {step.kind === "form" ? (
        <>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleUpload();
            }}
            className={SEND_CARD}
          >
            <h2 className={SEND_CARD_TITLE}>📋 Step 1 — Upload Manifest</h2>
            <div className={FORM_ROW}>
              <label className={FORM_GROUP}>
                Manifest (.csv or .xlsx)
                <input
                  key={fileInputKey}
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className={inputClass("blue")}
                />
              </label>
            </div>
            <p className={FORM_HINT}>
              Required columns: Order Number, Name, Phone, Pax, Pickup Time,
              Pickup Location, Agent, Driver, Bus#
            </p>
            <button
              type="submit"
              disabled={uploading}
              className={sendButtonClass("blue")}
            >
              {uploading ? "Uploading…" : "📂 Upload & Preview"}
            </button>
            {uploadError ? (
              <span role="alert" className={INLINE_ERROR}>
                {uploadError}
              </span>
            ) : (
              <span className="ml-3 text-[11px] text-[#aaa]">
                Nothing is sent at this step.
              </span>
            )}
          </form>
          <MessagePreviewPanel
            tabs={MESSAGE_PREVIEW_TABS}
            loadKey="morning"
            load={fetchMorningMessagePreview}
            tone="blue"
          />
        </>
      ) : null}

      {/* 旧页面的 How to use 在表单外面：预览、结果时也一直在（在它们上面）。 */}
      <MorningHowToUse />

      {step.kind === "preview" ? (
        <MorningPreviewStep
          fileName={step.manifest.file.name}
          rows={step.manifest.rows}
          selected={selected}
          onSelectedChange={setSelected}
          badPax={badPaxOrders(step.manifest.rows, selected)}
          sendType={sendType}
          onSendTypeChange={setSendType}
          onSend={() => setConfirming(true)}
          onStartOver={startOver}
        />
      ) : null}

      {step.kind === "sending" || step.kind === "done" ? (
        <MorningResults
          sending={step.kind === "sending"}
          sendType={step.sendType}
          orders={step.orders}
          results={step.results}
          notSelected={
            step.manifest.rows.filter(
              (r) => !step.orders.includes(r.order_number),
            ).length
          }
          stop={step.stop}
          onStartOver={startOver}
        />
      ) : null}

      {confirming && step.kind === "preview" && pendingOrders.length > 0 ? (
        <ConfirmDialog
          title="Send morning pickup reminders?"
          confirmLabel={`Send to ${pendingOrders.length} order${pendingOrders.length === 1 ? "" : "s"}`}
          busyLabel="Starting…"
          onClose={closeConfirm}
          onConfirm={async (): Promise<ActionResult> => {
            const manifest = step.manifest;
            setConfirming(false);
            void runSend(manifest, pendingOrders);
            return { status: "ok" };
          }}
        >
          <p>
            <b>{pendingOrders.length}</b> order
            {pendingOrders.length === 1 ? "" : "s"} will get today&apos;s pickup
            reminder by <b>{sendTypeShort(sendType)}</b>.
          </p>
          {resendCount > 0 ? (
            <p className="font-medium text-[#A32D2D]">
              {resendCount} of them already got today&apos;s message and will
              get a second one.
            </p>
          ) : null}
          <p>Messages go out to real guests and cannot be recalled.</p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

/** 文字照旧页面（后端 2026-10-06 版），按 ops 的实际按钮改写。 */
function MorningHowToUse() {
  return (
    <SendHowTo
      tone="blue"
      title="How to use — Morning Pickup Reminder"
      listClassName="mt-2"
      footerClassName="text-[#185FA5]"
      footer={
        <>
          ⚠️ Never delete or overwrite the header row in the file. This will
          break the upload and no reminders will be sent. ⚠️ If sending stops
          with an error, check the Send Log before sending again — the page
          lists which orders may already have gone out. Internal Server Error:
          stop, take a screenshot and notify Annie.
        </>
      }
    >
      <li>
        Export the manifest from Rezdy for today&apos;s tours. Upload it as .csv
        or .xlsx. Either way it needs the columns below, including Driver and
        Bus#.
      </li>
      <li>
        Do not remove or rename any header row. The following columns must be
        present and spelled exactly:
        <div className="mt-1.5 mb-1 overflow-x-auto rounded-md border border-[#b5d4f4] bg-white px-3 py-2 font-mono text-[11px] tracking-[0.2px] whitespace-nowrap text-[#185FA5]">
          Order Number &nbsp;·&nbsp; Name &nbsp;·&nbsp; Phone &nbsp;·&nbsp; Pax
          &nbsp;·&nbsp; Bus# &nbsp;·&nbsp; Driver &nbsp;·&nbsp; Pickup Time
          &nbsp;·&nbsp; Pickup Location &nbsp;·&nbsp; Agent
        </div>
        Missing or renamed columns will cause the upload to fail.
      </li>
      <li>
        Click Upload &amp; Preview. Guests are grouped by pickup location for
        easy review.
      </li>
      <li>
        If a red box says the guest count was not found for a ticked guest,
        nothing can be sent. Fix the quantity in Rezdy, download the file again
        and upload it (or untick that guest).
      </li>
      <li>
        Use the location toggle buttons to select or deselect an entire pickup
        group at once.
      </li>
      <li>
        Use the Select all / Deselect all buttons to manage all rows, or check
        individual rows to include or exclude specific guests.
      </li>
      <li>
        Guests who already got today&apos;s message are listed separately in the{" "}
        <span className="rounded bg-[#1A3A5C] px-1.5 py-px text-[11px] font-semibold text-[#dbe6f2]">
          dark panel
        </span>{" "}
        below the list, and are never picked up by Select all or the location
        toggles. To send someone a second message, tick them there (Send
        anyway). Each tick sends one more message only.
      </li>
      <li>
        A red pill such as SMS failed in the dark panel means one way failed and
        the other got through (for example Email delivered). Decide case by case
        whether to send again.
      </li>
      <li>
        If both SMS and email failed earlier, the guest is not counted as sent.
        They stay in the main list, ticked, and Send tries again.
      </li>
      <li>
        Default send mode is SMS Only. Switch to SMS + Email or Email Only if
        needed.
      </li>
      <li>
        Click Send to Selected and confirm. Guests who were already sent today
        show as Already sent today in the results and get nothing. If an order
        appears twice in the file, only the first row is sent; the other shows
        Listed twice in this file.
      </li>
    </SendHowTo>
  );
}
