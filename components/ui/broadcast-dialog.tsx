"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  type BroadcastSendResult,
  type BroadcastTemplate,
  fetchBroadcastTemplates,
  sendBroadcast,
} from "@/lib/broadcast-api";
import { describeSmsLength, SMS_MAX } from "@/lib/sms-limit";
import { cn } from "@/lib/utils";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";
import { Modal } from "./modal";

/** 群发候选人（一张单一行）。group 为 null 的（改期 / 取消等）任何群发都不发。 */
export interface BroadcastCandidate {
  key: string;
  orderNumber: string;
  name: string;
  firstName: string;
  phone: string;
  email: string;
  tourType: string;
  group: "pending" | "confirmed" | null;
}

type Group = "all" | "pending" | "sent";
type Channel = "both" | "sms" | "email";

/**
 * 模板接口挂了时的兜底（同旧页面那份内置副本）。用的时候弹窗里会明说。
 * ⚠️ Content Studio 里是空就是空，不能拿它顶上——只有接口失败才用。
 */
const FALLBACK_TEMPLATES: BroadcastTemplate[] = [
  {
    name: "tour_cancelled",
    label: "Tour cancelled",
    body: "Hi {first_name}, your National Park Express tour on {tour_date} has been cancelled. Please contact us at 702-948-4190 for assistance.",
  },
  {
    name: "time_changed",
    label: "Pickup time updated",
    body: "Hi {first_name}, your pickup time for your National Park Express tour on {tour_date} has been updated. Please contact us at 702-948-4190 for details.",
  },
  {
    name: "weather_delay",
    label: "Weather delay",
    body: "Hi {first_name}, due to weather conditions your National Park Express tour on {tour_date} may experience delays. We will keep you updated.",
  },
  { name: "custom", label: "Custom message", body: "" },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** 后端展开 {tour_date} 用 strftime('%B %d, %Y')（日补零），这里拼同样的串，字数才对得上。 */
function tourDateText(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[3]}, ${m[1]}` : "";
}

const GROUPS: readonly { value: Group; label: string; hint: string }[] = [
  {
    value: "all",
    label: "All",
    hint: "Everyone still on this tour (replied yes + no reply yet)",
  },
  { value: "pending", label: "Pending", hint: "No reply yet" },
  { value: "sent", label: "Confirmed", hint: "Guest replied yes" },
];

const CHANNELS: readonly { value: Channel; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "sms", label: "SMS only" },
  { value: "email", label: "Email only" },
];

type Phase =
  | { kind: "edit"; error: string | null }
  | { kind: "confirm" }
  | { kind: "sending" }
  | { kind: "done"; result: BroadcastSendResult };

/**
 * 📣 群发：选产品 → 选人群 → 写消息（可套模板）→ 选渠道 → 核对收件人 → 确认后发送。
 * ⚠️ **真实**发短信 / 邮件给每位勾选的客人。
 */
export function BroadcastDialog({
  module,
  templateSet,
  tourDate,
  tours,
  candidates,
  onClose,
  onSent,
  onUnauthorized,
}: {
  module: "tickets" | "tour";
  templateSet: "tix" | "tour";
  tourDate: string;
  /** 这天出现的产品；label 是屏幕上的短名（也存进群发记录）。 */
  tours: { value: string; label: string }[];
  candidates: BroadcastCandidate[];
  onClose: () => void;
  /** 发完（不论成败多少）：群发记录要重拉。 */
  onSent: () => void;
  onUnauthorized: () => void;
}) {
  const [templates, setTemplates] = useState<BroadcastTemplate[] | null>(null);
  const [signature, setSignature] = useState("");
  const [usingFallback, setUsingFallback] = useState(false);
  const [selectedTours, setSelectedTours] = useState<string[]>([]);
  const [group, setGroup] = useState<Group>("all");
  const [templateName, setTemplateName] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<Channel>("both");
  /** 取消勾选的收件人（默认全勾）。 */
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>({ kind: "edit", error: null });

  useEffect(() => {
    let cancelled = false;
    fetchBroadcastTemplates(templateSet)
      .then((set) => {
        if (!cancelled) {
          setTemplates(set.templates);
          setSignature(set.signature);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isStatus(error, 401)) {
          onUnauthorized();
          return;
        }
        setTemplates(FALLBACK_TEMPLATES);
        setUsingFallback(true);
      });
    return () => {
      cancelled = true;
    };
  }, [templateSet, onUnauthorized]);

  // 人群的唯一判据：只有 yes + pending 能收群发；三个计数和清单都从这里来。
  const pool = useMemo(
    () =>
      candidates.filter(
        (c) => c.group !== null && selectedTours.includes(c.tourType),
      ),
    [candidates, selectedTours],
  );
  const counts = {
    all: pool.length,
    pending: pool.filter((c) => c.group === "pending").length,
    sent: pool.filter((c) => c.group === "confirmed").length,
  };
  const recipients =
    group === "pending"
      ? pool.filter((c) => c.group === "pending")
      : group === "sent"
        ? pool.filter((c) => c.group === "confirmed")
        : pool;
  const picked = recipients.filter((c) => !unticked.has(c.key));
  const wantSms = channel !== "email";
  const wantEmail = channel !== "sms";
  const smsReach = picked.filter((c) => c.phone).length;
  const emailReach = picked.filter((c) => c.email).length;

  const trimmed = body.trim();
  const finalBody = signature ? `${trimmed}\n${signature}` : trimmed;
  // 按最坏情况算短信字数：签名 + 选中收件人里最长的名字 + 展开后的日期。
  const longestFirst = picked.reduce(
    (longest, c) =>
      (c.firstName || "Guest").length > longest.length
        ? c.firstName || "Guest"
        : longest,
    "Guest",
  );
  const smsText = finalBody
    .split("{first_name}")
    .join(longestFirst)
    .split("{tour_date}")
    .join(tourDateText(tourDate));
  const smsLength = describeSmsLength(smsText);
  const smsTooLong = wantSms && smsText.length > SMS_MAX;

  function productLabel(): string {
    if (!selectedTours.length) return "";
    if (selectedTours.length === tours.length && tours.length > 1) return "All";
    return tours
      .filter((t) => selectedTours.includes(t.value))
      .map((t) => t.label)
      .join(", ")
      .slice(0, 200);
  }

  function validate(): string | null {
    if (!trimmed) return "Please enter a message.";
    if (!selectedTours.length) return "Please select at least one tour.";
    if (!picked.length) return "No recipients selected.";
    if (smsTooLong) {
      return `This message is too long for SMS (${smsText.length.toLocaleString("en-US")} / ${SMS_MAX.toLocaleString("en-US")} characters, counting the signature and the expanded {first_name} / {tour_date}). Shorten it, or switch the channel to Email only.`;
    }
    return null;
  }

  async function send() {
    setPhase({ kind: "sending" });
    try {
      const result = await sendBroadcast({
        module,
        group_filter: group,
        status_filter: "all",
        tour_date: tourDate,
        product_label: productLabel(),
        template_name:
          templates
            ?.find((t) => t.name === templateName)
            ?.label.slice(0, 200) || null,
        message_body: finalBody,
        recipients: picked.map((c) => ({
          order_number: c.orderNumber,
          customer_name: c.name,
          first_name: c.firstName,
          phone: c.phone,
          email: c.email,
        })),
        send_sms: wantSms,
        send_email: wantEmail,
      });
      setPhase({ kind: "done", result });
      onSent();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      // 请求失败时后端有可能已经发出一部分：让 staff 先去核对，别直接再发。
      setPhase({
        kind: "edit",
        error: `Send failed: ${describeError(error)}. Some messages may already have gone out — check the Send Log before sending again.`,
      });
      onSent();
    }
  }

  const titleId = "broadcast-title";
  const busy = phase.kind === "sending";

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[92vh] max-w-2xl flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between bg-gradient-to-br from-[#f7cf6d] to-[#f4b23c] px-5 py-3.5 text-[#2c1b00]">
        <h2 id={titleId} className="text-base font-bold">
          📣 Broadcast message
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="text-2xl leading-none text-black/40 hover:text-black/70 disabled:opacity-50"
        >
          ×
        </button>
      </div>

      {phase.kind === "done" ? (
        <>
          <div className="flex flex-col gap-2 px-5 py-5 text-sm text-stone-800">
            <p className="font-semibold">Broadcast sent.</p>
            {wantSms ? (
              <p>
                SMS: {phase.result.sms_sent} sent,{" "}
                <span
                  className={
                    phase.result.sms_failed ? "font-semibold text-red-600" : ""
                  }
                >
                  {phase.result.sms_failed} failed
                </span>
              </p>
            ) : null}
            {wantEmail ? (
              <p>
                Email: {phase.result.email_sent} sent,{" "}
                <span
                  className={
                    phase.result.email_failed
                      ? "font-semibold text-red-600"
                      : ""
                  }
                >
                  {phase.result.email_failed} failed
                </span>
              </p>
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
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 text-sm">
            <Step title="Step 1 — Select tours">
              <div className="flex flex-wrap gap-2">
                <Chip
                  checked={
                    tours.length > 0 && selectedTours.length === tours.length
                  }
                  disabled={phase.kind !== "edit"}
                  onChange={(on) =>
                    setSelectedTours(on ? tours.map((t) => t.value) : [])
                  }
                  label="All"
                  bold
                />
                {tours.map((t) => (
                  <Chip
                    key={t.value}
                    checked={selectedTours.includes(t.value)}
                    disabled={phase.kind !== "edit"}
                    onChange={(on) =>
                      setSelectedTours((list) =>
                        on
                          ? [...list, t.value]
                          : list.filter((v) => v !== t.value),
                      )
                    }
                    label={t.label}
                  />
                ))}
                {tours.length === 0 ? (
                  <span className="text-stone-500">No tours on this date.</span>
                ) : null}
              </div>
            </Step>

            <Step title="Step 2 — Recipients">
              <div className="grid gap-2 sm:grid-cols-3">
                {GROUPS.map((g) => (
                  <label
                    key={g.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2",
                      group === g.value
                        ? "border-amber-400 bg-amber-50"
                        : "border-stone-200",
                    )}
                  >
                    <input
                      type="radio"
                      name="broadcast-group"
                      value={g.value}
                      checked={group === g.value}
                      disabled={phase.kind !== "edit"}
                      onChange={() => setGroup(g.value)}
                      className="mt-1"
                    />
                    <span className="flex-1">
                      <span className="block font-medium text-stone-800">
                        {g.label}
                      </span>
                      <span className="block text-xs text-stone-500">
                        {g.hint}
                      </span>
                    </span>
                    <span className="text-xs whitespace-nowrap text-stone-500">
                      {counts[g.value]} guests
                    </span>
                  </label>
                ))}
              </div>
            </Step>

            <Step title="Step 3 — Message">
              {usingFallback ? (
                <p className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                  ⚠️ Couldn&rsquo;t load templates from Content Studio — showing
                  built-in defaults. Any edits made in Content Studio are{" "}
                  <b>not</b> shown here. You can still type a message and send.
                </p>
              ) : null}
              <select
                aria-label="Template"
                value={templateName}
                disabled={phase.kind !== "edit" || templates === null}
                onChange={(event) => {
                  setTemplateName(event.target.value);
                  const t = templates?.find(
                    (x) => x.name === event.target.value,
                  );
                  if (t) setBody(t.body);
                }}
                className="mb-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
              >
                <option value="">
                  {templates === null
                    ? "Loading templates…"
                    : "— Select template —"}
                </option>
                {(templates ?? []).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="Message"
                value={body}
                disabled={phase.kind !== "edit"}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
                placeholder="Message body... (supports {first_name} and {tour_date})"
                className="w-full resize-y rounded-md border border-stone-300 px-3 py-2"
              />
              <p className="mt-1 text-xs text-stone-500">
                Supports {"{first_name}"} and {"{tour_date}"}
                {signature ? " · the signature is added automatically" : ""}
              </p>
              {wantSms && trimmed ? (
                <p
                  className={cn(
                    "mt-1 text-xs",
                    smsLength.over
                      ? "font-semibold text-red-600"
                      : "text-stone-500",
                  )}
                >
                  {smsLength.text}
                </p>
              ) : null}
            </Step>

            <Step title="Step 4 — Channel">
              <div className="flex gap-2">
                {CHANNELS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={channel === c.value}
                    disabled={phase.kind !== "edit"}
                    onClick={() => setChannel(c.value)}
                    className={cn(
                      "rounded-md border px-4 py-1.5 text-sm font-semibold",
                      channel === c.value
                        ? "border-amber-400 bg-gradient-to-br from-[#f7cf6d] to-[#f4b23c] text-[#2c1b00]"
                        : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </Step>

            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
              <div className="mb-1.5 text-xs text-stone-500">
                {recipients.length} recipient(s)
              </div>
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {recipients.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 rounded border border-stone-200 bg-white px-2 py-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={!unticked.has(c.key)}
                      disabled={phase.kind !== "edit"}
                      onChange={(event) =>
                        setUnticked((set) => {
                          const next = new Set(set);
                          if (event.target.checked) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1 font-medium text-stone-800">
                      {c.name || "—"}
                    </span>
                    <span className="text-stone-500">
                      {c.phone || c.email || "—"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-stone-700">
              {picked.length ? (
                <>
                  Will send:{" "}
                  {[
                    wantSms ? `📱 SMS ${smsReach}` : null,
                    wantEmail ? `✉ Email ${emailReach}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  <span className="text-stone-500">
                    {" "}
                    ({picked.length} of {recipients.length} selected
                    {wantSms && picked.length - smsReach
                      ? ` · ${picked.length - smsReach} no phone`
                      : ""}
                    {wantEmail && picked.length - emailReach
                      ? ` · ${picked.length - emailReach} no email`
                      : ""}
                    )
                  </span>
                </>
              ) : recipients.length ? (
                <span className="text-amber-700">No recipients selected.</span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-stone-200 px-5 py-3">
            {phase.kind === "edit" && phase.error ? (
              <p
                role="alert"
                className="rounded-md bg-[#FCEBEB] px-3 py-2 text-sm text-[#A32D2D]"
              >
                {phase.error}
              </p>
            ) : null}
            {phase.kind === "confirm" || phase.kind === "sending" ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">
                  Send this message to {picked.length} guest(s) now?
                </p>
                <p>
                  {[
                    wantSms ? `${smsReach} SMS` : null,
                    wantEmail ? `${emailReach} email(s)` : null,
                  ]
                    .filter(Boolean)
                    .join(" and ")}{" "}
                  will go out. This cannot be undone.
                </p>
                {picked.length !== recipients.length ? (
                  <p className="mt-1 font-semibold text-red-700">
                    {recipients.length - picked.length} selected recipient(s)
                    will NOT receive this message.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              {phase.kind === "edit" ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const problem = validate();
                      setPhase(
                        problem
                          ? { kind: "edit", error: problem }
                          : { kind: "confirm" },
                      );
                    }}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    📣 Send broadcast
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPhase({ kind: "edit", error: null })}
                    disabled={busy}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {busy ? "Sending…" : "Yes, send now"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Chip({
  checked,
  disabled,
  onChange,
  label,
  bold = false,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  bold?: boolean;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
        checked
          ? "border-amber-400 bg-amber-50 text-amber-900"
          : "border-stone-300 text-stone-700",
        bold && "font-semibold",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
