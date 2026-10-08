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

import { ModalShell } from "@/components/tracking-ui/modal-shell";

/**
 * 群发候选人（一张单一行）。
 * 门票页（audience="status"）：group 为 null 的（改期 / 取消等）任何群发都不发。
 * Tour 页（audience="mtlv"）：不看 group，人群是 General（所选团的全部客人）/ MTLV（mtlv 为 true 的），同旧页面。
 */
export interface BroadcastCandidate {
  key: string;
  orderNumber: string;
  name: string;
  firstName: string;
  phone: string;
  email: string;
  tourType: string;
  group: "pending" | "confirmed" | null;
  /** Tour 页：MTLV 资格。 */
  mtlv?: boolean;
}

type Group = "all" | "pending" | "sent" | "general" | "mtlv";
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

const MTLV_GROUPS: readonly { value: Group; label: string; hint: string }[] = [
  {
    value: "general",
    label: "General",
    hint: "All guests in selected tours",
  },
  { value: "mtlv", label: "MTLV", hint: "MTLV eligible guests only" },
];

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
  theme,
  module,
  templateSet,
  audience = "status",
  tourDate,
  tours: toursProp,
  candidates,
  onClose,
  onSent,
  onUnauthorized,
}: {
  /** 照哪一页的旧弹窗画：门票页深色、Tour 页奶油色（Annie 2026-10-07：和旧版一模一样）。 */
  theme: "tickets" | "tour";
  module: "tickets" | "tour";
  templateSet: "tix" | "tour";
  /** 人群怎么分：status = All / Pending / Confirmed（门票页）；mtlv = General / MTLV（Tour 页）。 */
  audience?: "status" | "mtlv";
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
  const [group, setGroup] = useState<Group>(
    audience === "mtlv" ? "general" : "all",
  );
  const groups = audience === "mtlv" ? MTLV_GROUPS : GROUPS;
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

  // 打开时拍一份候选人快照：外面每分钟自动刷新，不能让 staff 没看过的人混进「Yes, send now」。
  const [snapshot] = useState(candidates);
  // 产品按钮也用打开时那份，和候选人对得上。
  const [tours] = useState(toursProp);

  // 人群的唯一判据，计数和清单都从这里来。
  // 门票页只有 yes + pending 能收群发；Tour 页是所选团的全部客人（同旧页面，不按状态筛）。
  const pool = useMemo(
    () =>
      snapshot.filter(
        (c) =>
          (audience === "mtlv" || c.group !== null) &&
          selectedTours.includes(c.tourType),
      ),
    [snapshot, selectedTours, audience],
  );
  const byGroup: Record<Group, BroadcastCandidate[]> = {
    all: pool,
    pending: pool.filter((c) => c.group === "pending"),
    sent: pool.filter((c) => c.group === "confirmed"),
    general: pool,
    mtlv: pool.filter((c) => c.mtlv),
  };
  const recipients = byGroup[group];
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
  const skin = theme === "tickets" ? TICKETS_SKIN : TOUR_SKIN;

  return (
    <ModalShell
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      overlayClassName={skin.overlay}
      panelClassName={skin.panel}
    >
      <div className={cn("flex items-center px-[18px] py-3.5", skin.head)}>
        <h2
          id={titleId}
          className={cn("flex-1 text-[15px] font-bold", skin.headText)}
        >
          📣 Broadcast message
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="cursor-pointer text-[22px] leading-none text-black/40 disabled:opacity-50"
        >
          ×
        </button>
      </div>

      {phase.kind === "done" ? (
        <>
          <div
            className={cn(
              "flex flex-col gap-2 px-[18px] py-4 text-[13px]",
              skin.text,
            )}
          >
            <p className="font-semibold">Broadcast sent.</p>
            {wantSms ? (
              <p>
                SMS: {phase.result.sms_sent} sent,{" "}
                <span className={phase.result.sms_failed ? skin.failText : ""}>
                  {phase.result.sms_failed} failed
                </span>
              </p>
            ) : null}
            {wantEmail ? (
              <p>
                Email: {phase.result.email_sent} sent,{" "}
                <span
                  className={phase.result.email_failed ? skin.failText : ""}
                >
                  {phase.result.email_failed} failed
                </span>
              </p>
            ) : null}
          </div>
          <div
            className={cn(
              "flex justify-end gap-2 border-t px-[18px] py-3",
              skin.footBorder,
            )}
          >
            <button type="button" onClick={onClose} className={skin.sendBtn}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] py-4">
            <Step title="Step 1 — Select tours" className={skin.step}>
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                <Chip
                  checked={
                    tours.length > 0 && selectedTours.length === tours.length
                  }
                  disabled={phase.kind !== "edit"}
                  onChange={(on) =>
                    setSelectedTours(on ? tours.map((t) => t.value) : [])
                  }
                  label="All"
                  className={skin.allChip}
                  textClassName={skin.allChipText}
                  accent={skin.accent}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
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
                    // 两页的产品勾选都是白底黄边（旧页面就是这样，门票页的深色弹窗里也是）。
                    className="border-[#e8b84b] bg-white"
                    textClassName="text-[12px] text-[#7a4f00]"
                    accent="#ee8e00"
                  />
                ))}
                {tours.length === 0 ? (
                  <span className={cn("text-[12px]", skin.muted)}>
                    No tours on this date.
                  </span>
                ) : null}
              </div>
            </Step>

            <Step title="Step 2 — Recipients" className={skin.step}>
              <div className="flex gap-2">
                {groups.map((g) => (
                  <label
                    key={g.value}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center gap-1.5 rounded-[7px] border px-3.5 py-[7px]",
                      group === g.value ? skin.radioOn : skin.radioOff,
                    )}
                  >
                    <input
                      type="radio"
                      name="broadcast-group"
                      value={g.value}
                      checked={group === g.value}
                      disabled={phase.kind !== "edit"}
                      onChange={() => setGroup(g.value)}
                      style={{ accentColor: skin.accent }}
                    />
                    <span>
                      <span
                        className={cn(
                          "block text-[13px] font-medium",
                          skin.radioTitle,
                        )}
                      >
                        {g.label}
                      </span>
                      <span className={cn("block text-[11px]", skin.muted)}>
                        {g.hint}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "ml-auto text-[12px] whitespace-nowrap",
                        skin.muted,
                      )}
                    >
                      {byGroup[g.value].length} guests
                    </span>
                  </label>
                ))}
              </div>
            </Step>

            <Step title="Step 3 — Message" className={skin.step}>
              {usingFallback ? (
                <p
                  className={cn(
                    "mb-2 rounded-md border px-2.5 py-[7px] text-[11px] leading-[1.5]",
                    skin.warnBox,
                  )}
                >
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
                className={cn(
                  "mb-2 w-full rounded-md border px-2.5 py-[7px] text-[13px]",
                  skin.select,
                )}
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
                rows={3}
                placeholder="Message body... (supports {first_name} and {tour_date})"
                className={cn(
                  "block w-full resize-y rounded-md border px-2.5 py-2 font-[inherit] text-[13px]",
                  skin.textarea,
                )}
              />
              <p className={cn("mt-1 text-[11px]", skin.muted)}>
                Supports {"{first_name}"} and {"{tour_date}"}
                {signature ? " · the signature is added automatically" : ""}
              </p>
              {wantSms && trimmed ? (
                <p
                  className={cn(
                    "mt-1 text-[11px]",
                    smsLength.over
                      ? "font-semibold text-[#c0392b]"
                      : skin.counter,
                  )}
                >
                  {smsLength.text}
                </p>
              ) : null}
            </Step>

            <Step title="Step 4 — Channel" className={skin.step}>
              <div className="flex gap-1.5">
                {CHANNELS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={channel === c.value}
                    disabled={phase.kind !== "edit"}
                    onClick={() => setChannel(c.value)}
                    className={cn(
                      "cursor-pointer rounded-md px-4 py-[7px] text-[12px]",
                      channel === c.value
                        ? cn("border border-transparent font-bold", skin.active)
                        : cn("border font-semibold", skin.idle),
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </Step>

            <div
              data-recipient-list
              className={cn(
                "overflow-y-auto rounded-lg border px-3 py-2.5",
                skin.listBox,
              )}
            >
              <div className={cn("mb-[5px] text-[12px]", skin.listCount)}>
                {recipients.length} recipient(s)
              </div>
              <div className="flex flex-col gap-[3px]">
                {recipients.map((c) => (
                  <label
                    key={c.key}
                    className={cn(
                      "flex items-center gap-2 rounded border px-1.5 py-[3px] text-[12px]",
                      skin.listItem,
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={!unticked.has(c.key)}
                      disabled={phase.kind !== "edit"}
                      style={{ accentColor: skin.accent }}
                      onChange={(event) =>
                        setUnticked((set) => {
                          const next = new Set(set);
                          if (event.target.checked) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        })
                      }
                    />
                    <span className={cn("flex-1 font-medium", skin.listName)}>
                      {c.name || "—"}
                    </span>
                    <span className={cn("text-[11px]", skin.listContact)}>
                      {c.phone || c.email || "—"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className={cn("text-[12px]", skin.text)}>
              {picked.length ? (
                <>
                  Will send:{" "}
                  {wantSms ? (
                    <>
                      📱 SMS <b>{smsReach}</b>
                    </>
                  ) : null}
                  {wantSms && wantEmail ? " · " : null}
                  {wantEmail ? (
                    <>
                      ✉ Email <b>{emailReach}</b>
                    </>
                  ) : null}
                  <span className={skin.summaryExtra}>
                    {"  "}({picked.length} of {recipients.length} selected
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
                <span className={skin.noneSelected}>
                  No recipients selected.
                </span>
              ) : null}
            </p>
          </div>

          <div
            className={cn(
              "flex flex-col gap-2 border-t px-[18px] py-3",
              skin.footBorder,
            )}
          >
            {phase.kind === "edit" && phase.error ? (
              <p
                role="alert"
                className={cn(
                  "rounded-md border px-2.5 py-[7px] text-[12px]",
                  skin.warnBox,
                )}
              >
                {phase.error}
              </p>
            ) : null}
            {phase.kind === "confirm" || phase.kind === "sending" ? (
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-[13px]",
                  skin.confirmBox,
                )}
              >
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
                  <p className={cn("mt-1", skin.failText)}>
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
                    className={skin.cancelBtn}
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
                    className={skin.sendBtn}
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
                    className={skin.cancelBtn}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy}
                    className={skin.sendBtn}
                  >
                    {busy ? "Sending…" : "Yes, send now"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/** 门票页的群发弹窗：深色（tracking_tickets.html #broadcastOverlay）。 */
const TICKETS_SKIN = {
  overlay: "bg-black/70",
  panel:
    "flex max-h-[90vh] w-[580px] max-w-[95vw] flex-col overflow-hidden rounded-[14px] border border-white/15 bg-[#111a2b]",
  head: "bg-[linear-gradient(135deg,#f7cf6d,#f4b23c)]",
  headText: "text-[#2c1b00]",
  step: "text-white/40",
  text: "text-[#d9e8ff]",
  muted: "text-white/40",
  accent: "#f4b23c",
  allChip: "border-white/15 bg-white/[.08]",
  allChipText: "text-[12px] font-semibold text-[#d9e8ff]",
  radioOn: "border-white/15 bg-white/[.08]",
  radioOff: "border-white/15 bg-white/[.04]",
  radioTitle: "text-[#d9e8ff]",
  warnBox: "border-[#f87171] bg-[rgba(220,38,38,.18)] text-[#fecaca]",
  select: "border-white/15 bg-[#1e2d45] text-[#d9e8ff]",
  textarea: "border-white/15 bg-white/[.07] text-white",
  counter: "text-white/45",
  active: "bg-[linear-gradient(135deg,#f7cf6d,#f4b23c)] text-[#2c1b00]",
  idle: "border-white/15 bg-white/[.08] text-[#d9e8ff]",
  listBox: "max-h-[220px] border-white/[.12] bg-white/[.04]",
  listCount: "text-white/50",
  listItem: "border-white/10 bg-white/[.06]",
  listName: "text-[#d9e8ff]",
  listContact: "text-white/40",
  summaryExtra: "text-white/45",
  noneSelected: "text-[#f4b23c]",
  footBorder: "border-white/10",
  confirmBox:
    "border-[rgba(244,178,60,.45)] bg-[rgba(244,178,60,.12)] text-[#f7cf6d]",
  failText: "font-semibold text-[#f87171]",
  cancelBtn:
    "cursor-pointer rounded-md border border-white/15 bg-white/[.08] px-4 py-[7px] text-[13px] text-[#d9e8ff] disabled:opacity-50",
  sendBtn:
    "cursor-pointer rounded-md border-none bg-[linear-gradient(135deg,#f7cf6d,#f4b23c)] px-[18px] py-[7px] text-[13px] font-bold text-[#2c1b00] disabled:opacity-60",
};

/** Tour 页的群发弹窗：奶油色（tracking_tour.html #broadcastOverlay）。 */
const TOUR_SKIN: typeof TICKETS_SKIN = {
  overlay: "bg-black/45",
  panel:
    "flex max-h-[90vh] w-[580px] max-w-[95vw] flex-col overflow-hidden rounded-[12px] border border-[#e8b84b] bg-[#FFFDF5]",
  head: "bg-[linear-gradient(135deg,#ffce21,#ee8e00)]",
  headText: "text-[#1a1a1a]",
  step: "text-[#b86a00]",
  text: "text-[#7a4f00]",
  muted: "text-[#b86a00]",
  accent: "#ee8e00",
  allChip: "border-[#e8b84b] bg-[#fff3cd]",
  allChipText: "text-[12px] font-semibold text-[#7a4f00]",
  radioOn: "border-[#e8b84b] bg-[#fff3cd]",
  radioOff: "border-[#e8b84b] bg-[#FFFDF5]",
  radioTitle: "text-[#7a4f00]",
  warnBox: "border-[#dc2626] bg-[#fef2f2] text-[#991b1b]",
  select: "border-[#e8b84b] bg-white text-[#7a4f00]",
  textarea: "border-[#e8b84b] bg-white text-[#1a1a1a]",
  counter: "text-[#a07a3a]",
  active: "bg-[linear-gradient(135deg,#ffce21,#ee8e00)] text-[#1a1a1a]",
  idle: "border-[#e8b84b] bg-white text-[#7a4f00]",
  listBox: "max-h-[150px] border-[#e8b84b] bg-[#fff8e1]",
  listCount: "text-[#b86a00]",
  listItem: "border-[#e8b84b] bg-white",
  listName: "text-[#1a1a1a]",
  listContact: "text-[#b86a00]",
  summaryExtra: "text-[#a07a3a]",
  noneSelected: "font-semibold text-[#b45309]",
  footBorder: "border-[#f5e6c8]",
  confirmBox: "border-[#e8b84b] bg-[#fff3cd] text-[#7a4f00]",
  failText: "font-semibold text-[#dc2626]",
  cancelBtn:
    "cursor-pointer rounded-md border border-[#e8b84b] bg-white px-4 py-[7px] text-[13px] text-[#7a4f00] disabled:opacity-50",
  sendBtn:
    "cursor-pointer rounded-md border-none bg-[linear-gradient(135deg,#ffce21,#ee8e00)] px-[18px] py-[7px] text-[13px] font-bold text-[#1a1a1a] disabled:opacity-60",
};

function Step({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3
        className={cn(
          "mb-2 text-[11px] font-semibold tracking-[.05em] uppercase",
          className,
        )}
      >
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
  className,
  textClassName,
  accent,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className: string;
  textClassName: string;
  accent: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-[5px] rounded-[20px] border px-2.5 py-[3px]",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        style={{ accentColor: accent }}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={textClassName}>{label}</span>
    </label>
  );
}
