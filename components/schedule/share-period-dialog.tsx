"use client";

import { useEffect, useId, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { shiftYmd } from "@/lib/la-date";
import {
  previewPeriodShare,
  type PeriodSharePreview,
  type PeriodShareResult,
  sendPeriodShare,
  shareErrorOf,
  splitMissed,
} from "@/lib/schedule-period-api";
import { isUnavailable } from "@/lib/schedule-confirm-api";

type Step =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      preview: PeriodSharePreview;
      sending: boolean;
      error: string | null;
    }
  | { kind: "done"; result: PeriodShareResult };

const AT_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

function md(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Period › Share with staff（Annie 2026-11-08 preview HnBVL6wANcCZYs1r1enq3W ②，全 A）：先 dry_run 列出会收到的人、
 * 收不到的人和原因；有没发布的周 ⇒ 红框写哪几周、Send 灰掉；同一段发过 ⇒ 黄框写谁什么时候发的。
 * 按蓝色 Send to N staff 才真发；结果绿字写发给了几个人，收不到的红字逐人写原因。
 */
export function SharePeriodDialog({
  start,
  weeks,
  onClose,
  onUnauthorized,
}: {
  start: string;
  weeks: number;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const titleId = useId();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const end = shiftYmd(start, weeks * 7 - 1);

  useEffect(() => {
    let alive = true;
    previewPeriodShare(start, weeks)
      .then((preview) => {
        if (alive)
          setStep({ kind: "ready", preview, sending: false, error: null });
      })
      .catch((e) => {
        if (!alive) return;
        if (isStatus(e, 401)) onUnauthorized();
        else if (isUnavailable(e)) setStep({ kind: "unavailable" });
        else setStep({ kind: "error", message: describeError(e) });
      });
    return () => {
      alive = false;
    };
  }, [start, weeks, onUnauthorized]);

  async function send(preview: PeriodSharePreview) {
    setStep({ kind: "ready", preview, sending: true, error: null });
    try {
      const result = await sendPeriodShare(start, weeks);
      setStep({ kind: "done", result });
    } catch (e) {
      if (isStatus(e, 401)) return onUnauthorized();
      const nested = shareErrorOf(e);
      const message = nested.message
        ? `${nested.message}${nested.weeks.length ? ` (${nested.weeks.map((w) => `week of ${md(w)}`).join(", ")})` : ""}`
        : describeError(e);
      setStep({
        kind: "ready",
        preview: nested.weeks.length
          ? { ...preview, unpublished: nested.weeks }
          : preview,
        sending: false,
        error: message,
      });
    }
  }

  const busy = step.kind === "ready" && step.sending;

  return (
    <Modal titleId={titleId} onDismiss={busy ? undefined : onClose} night>
      <div data-share-period className="flex flex-col gap-4">
        <h2
          id={titleId}
          className="text-lg font-semibold text-stone-900 night:text-white/90"
        >
          Share {md(start)} – {md(end)} with staff?
        </h2>
        <div className="flex flex-col gap-3 text-sm break-words text-[#1a1a1a] night:text-white/75">
          {step.kind === "loading" ? <p>Checking who will get it…</p> : null}
          {step.kind === "unavailable" ? (
            <p data-share-unavailable>Share with staff is not available yet.</p>
          ) : null}
          {step.kind === "error" ? (
            <p role="alert" className="text-[#A32D2D] night:text-red-300">
              {step.message}
            </p>
          ) : null}
          {step.kind === "ready" ? (
            <ReadyBody preview={step.preview} weeks={weeks} />
          ) : null}
          {step.kind === "ready" && step.error ? (
            <p role="alert" className="text-[#A32D2D] night:text-red-300">
              {step.error}
            </p>
          ) : null}
          {step.kind === "done" ? <DoneBody result={step.result} /> : null}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS}
          >
            {step.kind === "done" ? "Close" : "Cancel"}
          </button>
          {step.kind === "ready" ? (
            <button
              type="button"
              data-share-send
              disabled={
                step.sending ||
                step.preview.unpublished.length > 0 ||
                step.preview.recipients.length === 0
              }
              onClick={() => void send(step.preview)}
              className={DARK_PRIMARY_BUTTON_CLASS}
            >
              {step.sending
                ? "Sending…"
                : `Send to ${step.preview.recipients.length} staff`}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function ReadyBody({
  preview,
  weeks,
}: {
  preview: PeriodSharePreview;
  weeks: number;
}) {
  return (
    <>
      <p>
        Each person gets one email with a link to their own shifts for these{" "}
        {weeks} week{weeks === 1 ? "" : "s"}. They confirm all {weeks} week
        {weeks === 1 ? "" : "s"} at once, or ask for a change on a day.
      </p>
      {preview.unpublished.length > 0 ? (
        <p
          data-share-unpublished
          className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[#A32D2D] night:text-red-300"
        >
          {preview.unpublished.map((w) => `Week of ${md(w)}`).join(", ")}{" "}
          {preview.unpublished.length === 1 ? "is" : "are"} not published yet.
          Publish {preview.unpublished.length === 1 ? "it" : "them"} on the
          Schedule tab first.
        </p>
      ) : null}
      {preview.already_shared.length > 0 ? (
        <p
          data-share-already
          className="rounded-[8px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-3 py-2 text-[#8a5a00] night:text-[#fde68a]"
        >
          Already shared:{" "}
          {preview.already_shared
            .map((a) => `by ${a.by} on ${AT_FMT.format(new Date(a.at))}`)
            .join("; ")}
          . Sending again emails everyone again.
        </p>
      ) : null}
      {preview.recipients.length > 0 ? (
        <div data-share-recipients>
          <p className="font-semibold">
            {preview.recipients.length} staff will get it:
          </p>
          <p>{preview.recipients.map((r) => r.name).join(", ")}</p>
        </div>
      ) : (
        <p data-share-nobody>Nobody is scheduled in these weeks.</p>
      )}
      <NotReached from={preview} />
    </>
  );
}

function DoneBody({ result }: { result: PeriodShareResult }) {
  return (
    <>
      <p
        data-share-done
        className="font-semibold text-[#3B6D11] night:text-[#4ade80]"
      >
        Sent to {result.notified.length} staff.
      </p>
      <NotReached from={result} />
    </>
  );
}

/**
 * 没收到的人（置顶 109 Q1 / Q6，员工通知和客人发送同一套）：没邮箱 = 灰字 No email，不算失败；
 * 真的发失败（email could not be sent / link could not be made）= 红字 Not sent + 原因。
 * W4 第二段起读后端的 no_contact / failed，旧后端退回 not_reached（splitMissed）。
 */
function NotReached({
  from,
}: {
  from: PeriodSharePreview | PeriodShareResult;
}) {
  const { noContact: noEmail, failed } = splitMissed(from);
  return (
    <>
      {failed.length > 0 ? (
        <div
          data-share-not-reached
          className="text-[#A32D2D] night:text-red-300"
        >
          <p className="font-semibold">Not sent:</p>
          <ul className="list-disc pl-5">
            {failed.map((p) => (
              <li key={p.employee_id}>
                {p.name} — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {noEmail.length > 0 ? (
        <p data-share-no-email className="text-[#6B6B6B] night:text-white/55">
          No email: {noEmail.map((p) => p.name).join(", ")}.
        </p>
      ) : null}
    </>
  );
}
