"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { legacyUrl } from "@/components/dashboard/config";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { MessagePreviewPanel } from "@/components/ui/message-preview-panel";
import { Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { fetchTourMessagePreview, fetchTourTypes } from "@/lib/tour-send-api";
import type { TourTypeOption } from "@/types";

import { MESSAGE_PREVIEW_TABS } from "./config";
import { TourLaneSection } from "./tour-lane";

/** Tour tracking 页：还在旧后台，迁过来以后改成站内路径。 */
const TOUR_TRACKING_HREF = legacyUrl(
  "/admin/notifications/tour-confirmation/tracking",
);

export function TourSendView() {
  const [tourTypes, setTourTypes] = useState<TourTypeOption[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [selection, setSelection] = useState({ tourType: "", tourDate: "" });
  const [sendingLanes, setSendingLanes] = useState({
    regular: false,
    lm: false,
  });
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchTourTypes(controller.signal)
      .then((t) => setTourTypes(t))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setForbidden(true);
        else
          setTypesError(
            error instanceof TypeError
              ? "could not reach the server."
              : describeError(error),
          );
      });
    return () => controller.abort();
  }, [redirectToLogin]);

  // 发送中离开页面会中断剩下的批次，先提示。
  const sending = sendingLanes.regular || sendingLanes.lm;
  useEffect(() => {
    if (!sending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sending]);

  const onRegularSending = useCallback(
    (v: boolean) => setSendingLanes((s) => ({ ...s, regular: v })),
    [],
  );
  const onLmSending = useCallback(
    (v: boolean) => setSendingLanes((s) => ({ ...s, lm: v })),
    [],
  );
  const onSelection = useCallback(
    (tourType: string, tourDate: string) =>
      setSelection({ tourType, tourDate }),
    [],
  );

  if (forbidden) {
    return (
      <Shell>
        <Panel>
          <p className="font-medium text-stone-800">Staff access required</p>
        </Panel>
      </Shell>
    );
  }

  const { tourType, tourDate } = selection;
  return (
    <Shell>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Tour Confirmation
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">Send</h1>
        </div>
        <a href={TOUR_TRACKING_HREF} className={SECONDARY_BUTTON_CLASS}>
          View Tracking
        </a>
      </header>

      <TourLaneSection
        lane="tour_confirmation"
        tourTypes={tourTypes}
        tourTypesError={typesError}
        onUnauthorized={redirectToLogin}
        onSendingChange={onRegularSending}
        onSelectionChange={onSelection}
      >
        <div className="flex max-w-3xl flex-col gap-4">
          <MessagePreviewPanel
            tabs={MESSAGE_PREVIEW_TABS}
            loadKey={`${tourType}|${tourDate}`}
            load={
              tourType && tourDate
                ? (signal) =>
                    fetchTourMessagePreview(tourType, tourDate, signal)
                : null
            }
            idleText="Select a tour type and tour date above to preview the message content."
          />
          <HowToUse />
        </div>
      </TourLaneSection>

      <div className="border-t border-stone-300 pt-5">
        <TourLaneSection
          lane="last_minute"
          tourTypes={tourTypes}
          tourTypesError={typesError}
          onUnauthorized={redirectToLogin}
          onSendingChange={onLmSending}
        >
          <HowToUseLastMinute />
        </TourLaneSection>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        {children}
      </div>
    </main>
  );
}

function HowToUse() {
  return (
    <details className="rounded-lg border border-[#d4e6c3] bg-[#f7f9f5] px-5 py-4 text-sm leading-relaxed text-[#4a5a3a]">
      <summary className="cursor-pointer font-semibold text-[#3B6D11]">
        📖 How to use — Tour Confirmation
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Download the CSV from Rezdy and upload it as is. Do not open it in
          Excel first. An .xlsx file still works.
        </li>
        <li>Select the matching Tour Type and Tour Date above.</li>
        <li>
          Upload the file. The filename should match the tour and date (e.g.{" "}
          <code>west-bus-2026-10-02.csv</code>).
        </li>
        <li>
          Click Upload &amp; Preview to review the guest list before sending.
        </li>
        <li>
          For a CSV, Qty shows the guest count and Quantities shows the ticket
          types next to it. Check they match.
        </li>
        <li>
          If a row shows ? in Qty and turns red, the guest count was not found
          and nothing can be sent. Fix the quantity in Rezdy, download the CSV
          again and upload it.
        </li>
        <li>
          Any orders already sent are flagged with who sent them and when, and
          skipped. Tick Send anyway to send them again. Send anyway sends an
          order once: sending again does not send it a third time.
        </li>
        <li>
          If you upload a file for a tour and date that already has orders in
          the system, a blue box above the list shows what is different: Added,
          Removed and Changed orders, with the old and new values.
        </li>
        <li>
          Click Apply to save the new file. Apply does not send anything. To
          send a changed order again (for example the pickup time changed), tick
          Send anyway on that order, then send.
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
          If an order is in the file twice with the same details, the second row
          is marked Listed twice in this file and the guest gets one message. If
          the two rows have different details, or a row has no order number,
          nothing can be sent: fix the file and upload it again.
        </li>
        <li>
          Choose SMS + Email, SMS Only, or Email Only, then click Send to All
          and confirm. A bar shows how many have been done. Keep the page open
          until Send Results appears.
        </li>
        <li>
          Send Results shows Sent, Failed and Skipped. Skipped orders were
          already sent or listed twice, and the list says which. Click View this
          send to open this send in the Send Log.
        </li>
      </ol>
      <div className="mt-3 border-t border-[#d4e6c3] pt-3 text-[#185FA5]">
        <p className="font-semibold">
          ⚠️ Never delete or overwrite the header row in the file. This will
          break the upload and no messages will be sent.
        </p>
        <p className="mt-1 font-semibold">⚠️ Error Handling</p>
        <ul className="list-disc pl-5">
          <li>
            The page says it lost contact with the server: stop and do not send
            again. Click View this send to see which messages went out. If
            something really went wrong, wait a few minutes, then click Send
            Another and upload the file again: orders already sent are skipped
            and never sent twice.
          </li>
          <li>
            Internal Server Error: Stop sending immediately. Take a screenshot
            and notify Annie. Use alternative channels for urgent
            communications. Non-urgent orders should wait until the issue is
            resolved. Most system issues are fixed within 2 hours.
          </li>
        </ul>
      </div>
    </details>
  );
}

function HowToUseLastMinute() {
  return (
    <details className="max-w-3xl rounded-lg border border-[#e8d5b0] bg-[#fdf6ee] px-5 py-4 text-sm leading-relaxed text-[#5a4020]">
      <summary className="cursor-pointer font-semibold text-[#7C4A00]">
        📖 How to use — Last Minute Order
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Use this section only for orders placed within the cancellation window
          (typically same-day or next-day bookings).
        </li>
        <li>
          These guests skip the reconfirmation step and go directly to lunch
          selection &amp; pickup details.
        </li>
        <li>
          Select the Tour Type and Tour Date, then upload the manifest. Download
          the CSV from Rezdy and upload it as is. Do not open it in Excel first.
          An .xlsx file still works.
        </li>
        <li>
          Review the preview. If a row shows ? in Qty and turns red, nothing can
          be sent: fix the quantity in Rezdy, download the CSV again and upload
          it.
        </li>
        <li>
          If this tour and date already have last minute orders in the system, a
          blue box shows Added, Removed and Changed orders. Click Apply to save
          the new file (nothing is sent). Removed orders get no message.
        </li>
        <li>
          Orders already sent from this section or from Tour Confirmation for
          the same date are marked and skipped. Tick Send anyway to send them
          again. An order in the file twice with the same details gets one
          message.
        </li>
        <li>
          Click Send Last Minute, confirm, and keep the page open until the
          results appear. Click View this send to open this send in the Send
          Log.
        </li>
      </ol>
      <div className="mt-3 border-t border-[#e8d5b0] pt-3 text-stone-500">
        <p>
          ⚠️ Do not use this for regular bookings — guests will not receive the
          standard confirmation &amp; reconfirmation flow.
        </p>
        <p className="mt-1 font-semibold">⚠️ Error Handling</p>
        <ul className="list-disc pl-5">
          <li>
            The page says it lost contact with the server: stop and do not send
            again. Click View this send to see which messages went out. If
            something really went wrong, wait a few minutes, then click Send
            Another and upload the file again: orders already sent are skipped
            and never sent twice.
          </li>
          <li>
            Internal Server Error: Stop sending immediately. Take a screenshot
            and notify Annie. Use alternative channels for urgent
            communications. Non-urgent orders should wait until the issue is
            resolved. Most system issues are fixed within 2 hours.
          </li>
        </ul>
      </div>
    </details>
  );
}
