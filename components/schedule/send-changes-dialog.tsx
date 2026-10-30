"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/modal";
import {
  BLUE_BOX,
  DUP_BADGE,
  LIGHT_BUTTON,
  PREVIEW_CARD,
  previewHeaderClass,
  sendButtonClass,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
import { describeError, isStatus } from "@/lib/api-errors";
import { sendScheduleChanges } from "@/lib/schedule-api";
import { cn } from "@/lib/utils";
import type { ScheduleEmployee, SchedulePendingChange } from "@/types";

import { DAY_LABELS } from "./config";

/**
 * "2026-10-05" → "Mon 10/5"：不补零，照后端邮件 / 站内通知的写法（schedule.py day_label，ef 10-30）。
 * 发送框里表格和「What X gets」原文都用这一种，排班页别处的日期格式不动。
 */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${DAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
}

/** "Oct 29, 9:42 PM"（洛杉矶时间）。 */
export function sentTime(iso: string, withDate = false): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * 发布前把这个人改动的班单独发给本人确认（Annie 2026-10-29「员工确认，同意推荐，动手」，
 * preview https://claude.ai/artifact/NfWdfaxPUSS6SR8PGmxNrv ）。样子照全站统一的发送格式（tickets-send/legacy-ui）：
 * 表格只列改了的（哪天、原来划线、现在），写发给谁、对方收到的话；蓝色只有 Send；发好绿字 + 「Sent by 谁 on 时间」，失败红字后端原话。
 * 没有邮箱：黄框，Send 灰着（排班员工只有邮箱，不发短信）。
 */
export function SendChangesDialog({
  weekStart,
  weekLabel,
  employee,
  change,
  onClose,
  onSent,
  onUnauthorized,
}: {
  weekStart: string;
  /** 例「Nov 1 – 7, 2026」。 */
  weekLabel: string;
  employee: ScheduleEmployee;
  change: SchedulePendingChange;
  onClose: () => void;
  /** 发好以后（重读这一周，行上写 Sent to …）。 */
  onSent: () => void;
  onUnauthorized: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; at: string; by: string; channels: string[] }
    | { kind: "error"; message: string }
    | null
  >(null);
  const name = employee.name;
  const n = change.items.length;
  const sent = result?.kind === "ok";
  const sentAt = sent ? result.at : change.sent_at;
  const sentBy = sent ? result.by : change.sent_by;
  const noEmail = !employee.email;

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const r = await sendScheduleChanges(weekStart, employee.id);
      setResult({
        kind: "ok",
        at: r.sent_at,
        by: r.sent_by,
        channels: r.channels,
      });
      onSent();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setResult({
        kind: "error",
        message: `Could not send: ${describeError(error)} Nothing was sent.`,
      });
    } finally {
      setBusy(false);
    }
  }

  // 对方收到的原文照后端 G217（ef，10-30）：每行「Mon 10/19: 原来 → 现在」，没班写 not scheduled；{week} = 周日日期。
  const lines = change.items.map(
    (i) =>
      `${dayLabel(i.date)}: ${i.before ?? "not scheduled"} → ${i.after ?? "not scheduled"}`,
  );
  const subject = `Please confirm your schedule changes — week of ${weekStart}`;
  // 没带 has_login（后端没上线）当有：照旧写邮箱 + 站内。
  const inApp = change.has_login !== false;

  return (
    <Modal
      titleId="send-changes-title"
      onDismiss={busy ? undefined : onClose}
      panelClassName="max-w-[640px] p-5"
    >
      <div data-send-changes-dialog>
        <h2
          id="send-changes-title"
          className="mb-3 text-[15px] font-semibold text-[#1a1a1a]"
        >
          Send {name} their changes to confirm
        </h2>
        {sentAt ? (
          <div className="mb-2">
            <span data-sent-by className={DUP_BADGE}>
              Sent{sentBy ? ` by ${sentBy}` : ""} on {sentTime(sentAt, true)}
            </span>
          </div>
        ) : null}
        <div className={PREVIEW_CARD}>
          <div className={previewHeaderClass("blue")}>
            <span className="text-[13px] font-semibold text-[#185FA5]">
              {name} · {weekLabel} · {n} {n === 1 ? "change" : "changes"} since
              you published
            </span>
          </div>
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Day", "Was", "Now"].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {change.items.map((i) => (
                  <tr
                    key={i.date + (i.before ?? "") + (i.after ?? "")}
                    data-change-row={i.date}
                    className={cn(TR, sent && "bg-[#fffbea]")}
                  >
                    <td className={cn(TD, "font-semibold")}>
                      {dayLabel(i.date)}
                    </td>
                    <td className={cn(TD, "text-[#6b7280] line-through")}>
                      {i.before ?? "—"}
                    </td>
                    <td className={cn(TD, "font-semibold")}>
                      {i.after ?? "Removed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {noEmail ? (
          <div data-no-email className={YELLOW_BOX}>
            <b>No email for {name}.</b> Add it in Employees, then send. Until
            then {name} only sees the change after you publish again.
          </div>
        ) : (
          <>
            <p data-send-to className="mb-3 text-[12.5px] text-[#1a1a1a]">
              <b>To:</b> 📧 {employee.email}
              {inApp ? <>&nbsp;+&nbsp; 🔔 in-app notice</> : null}
            </p>
            <div data-send-preview className={BLUE_BOX}>
              <b>What {name} gets:</b>
              <div className="mt-1">
                <b>Subject:</b> {subject}
              </div>
              <div className="mt-1.5 whitespace-pre-line">
                {`Hi ${name},\nYour schedule for the week of ${weekStart} has changed:\n${lines.map((l) => `• ${l}`).join("\n")}\nPlease check and confirm:`}
              </div>
              <div className="mt-1 font-semibold">[Confirm my schedule]</div>
              <div className="mt-1.5">
                The button opens the same confirm page they use on Wednesdays.
                {inApp
                  ? " The in-app notice has the same subject and lines."
                  : null}
              </div>
            </div>
          </>
        )}
        {result?.kind === "ok" ? (
          <p
            role="status"
            data-send-ok
            className="mb-3 text-[13px] font-semibold text-[#15803d]"
          >
            ✓ Sent to {name} · {sentTime(result.at)} (
            {result.channels
              .map((c) => (c === "in_app" ? "in-app" : c))
              .join(" + ")}
            )
          </p>
        ) : result?.kind === "error" ? (
          <p
            role="alert"
            data-send-error
            className="mb-3 text-[13px] font-semibold text-[#A32D2D]"
          >
            {result.message}
          </p>
        ) : null}
        <p className="mb-3 text-[11.5px] text-[#555]">
          Only {name} gets this. When you publish again, {name} and the
          supervisors and admins who can edit the schedule still get the normal
          notice.
        </p>
        <div className="flex justify-end gap-2.5">
          {sent ? (
            <button type="button" onClick={onClose} className={LIGHT_BUTTON}>
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className={LIGHT_BUTTON}
              >
                Cancel
              </button>
              <button
                type="button"
                data-send-changes-go
                disabled={busy || noEmail}
                onClick={() => void send()}
                className={sendButtonClass("blue")}
              >
                {busy ? "Sending…" : `Send to ${name}`}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
