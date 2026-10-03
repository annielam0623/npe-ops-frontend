"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  createBookingNote,
  createTicketNote,
  fetchBookingNotes,
  fetchTicketNotes,
  toggleTakeAction,
} from "@/lib/booking-notes-api";
import { isInbound } from "@/lib/channels";
import { describeSmsLength, SMS_MAX } from "@/lib/sms-limit";
import { LA_TIME_ZONE } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type { BookingNote, NoteCreate, NoteLine } from "@/types";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";
import { Modal } from "./modal";

/** 弹窗开着时每 20 秒重拉一次对话（与旧页面一致）。 */
const NOTES_POLL_MS = 20_000;

export interface ContactBadge {
  text: string;
  tone: "good" | "bad" | "muted";
}

/**
 * 对话从哪取：
 * - order：按订单号（bookings 表，早班页带 line=morning）；
 * - ticket：按门票行 id（tickets_reminders 表，?source=tickets）。
 */
export type ConversationSource =
  { kind: "order"; line?: NoteLine } | { kind: "ticket" };

export interface ConversationTarget {
  /** order 来源是 bookings.id，ticket 来源是 tickets_reminders.id；Take action 用它。 */
  bookingId: number;
  orderNumber: string;
  guestName: string;
  phone: string;
  email: string;
  /** 这单早先那条通知的投递结果，写在电话 / 邮箱旁边。 */
  smsBadge: ContactBadge | null;
  emailBadge: ContactBadge | null;
  /** 表格行里的处理人；接口不回处理人时（ticket 来源）用它，表格重拉后跟着变。 */
  actionTakenBy: string;
  /** 客人在确认页填的留言（门票页）：接口里没有，作为一条 Guest 消息按时间插进对话。 */
  guestForm?: { body: string; submittedAt: string | null };
}

const LA_MINUTE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO → "YYYY-MM-DD HH:MM"（洛杉矶），和接口回的 created_at 同一种写法，好排序。 */
function toLaMinute(iso: string | null): string {
  const time = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(time)) {
    return "";
  }
  const parts = Object.fromEntries(
    LA_MINUTE_FORMAT.formatToParts(time).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 把确认页留言并进对话；已经有同样文字的 guest_reply 时不重复。 */
function withGuestForm(
  notes: BookingNote[],
  guestForm: ConversationTarget["guestForm"],
): BookingNote[] {
  const body = guestForm?.body.trim();
  if (
    !body ||
    notes.some((n) => n.direction === "guest_reply" && n.body.trim() === body)
  ) {
    return notes;
  }
  return [
    ...notes,
    {
      id: -1,
      booking_id: 0,
      author_username: "",
      direction: "guest_reply",
      body,
      sms_status: null,
      email_status: null,
      created_at: toLaMinute(guestForm?.submittedAt ?? null),
    },
  ];
}

const DIRECTION_LABEL: Record<string, { label: string; className: string }> = {
  staff_note: { label: "★ Note", className: "text-amber-600" },
  sms_out: { label: "SMS sent", className: "text-emerald-700" },
  email_out: { label: "Email sent", className: "text-sky-700" },
  sms_in: { label: "Guest via SMS", className: "text-orange-700" },
  email_in: { label: "Guest via Email", className: "text-blue-700" },
  guest_reply: { label: "Guest", className: "text-slate-600" },
};

/** 发给客人的消息带投递结果时，标签写结果：不是 sent 一律算没发出去。 */
function noteLabel(note: BookingNote): { label: string; className: string } {
  if (note.sms_status || note.email_status) {
    const parts: string[] = [];
    let failed = false;
    if (note.sms_status) {
      const ok = note.sms_status === "sent";
      failed ||= !ok;
      parts.push(`SMS ${ok ? "sent" : "failed"}`);
    }
    if (note.email_status) {
      const ok = note.email_status === "sent";
      failed ||= !ok;
      parts.push(`Email ${ok ? "sent" : "failed"}`);
    }
    return {
      label: parts.join(", "),
      className: failed ? "text-red-600" : "text-emerald-700",
    };
  }
  return (
    DIRECTION_LABEL[note.direction] ?? {
      label: note.direction,
      className: "text-stone-500",
    }
  );
}

type Notice = { tone: "error" | "warn"; text: string } | null;

/**
 * 一单的对话：看全部往来、写内部备注、发短信 / 邮件给客人、标记已处理。
 * ⚠️ 「Send →」会**真实发送**给客人。
 */
export function ConversationModal({
  target,
  source,
  onClose,
  onChanged,
  onUnauthorized,
}: {
  target: ConversationTarget;
  source: ConversationSource;
  onClose: () => void;
  /** 写了备注 / 发了消息 / 改了 Take action：表格要重拉。 */
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const { orderNumber, bookingId, guestForm } = target;
  const sourceKind = source.kind;
  const line = source.kind === "order" ? source.line : undefined;
  const [notes, setNotes] = useState<BookingNote[] | null>(null);
  /** 接口回的处理人（order 来源）；null = 接口不回，用表格行里的。 */
  const [fetchedActionBy, setFetchedActionBy] = useState<string | null>(null);
  const actionBy = fetchedActionBy ?? target.actionTakenBy;
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState("");
  const [smsChecked, setSmsChecked] = useState(true);
  const [emailChecked, setEmailChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const hasPhone = !!target.phone.trim();
  const hasEmail = !!target.email.trim();
  const sendSms = smsChecked && hasPhone;
  const sendEmail = emailChecked && hasEmail;

  const loadNotes = useCallback(
    async (signal?: AbortSignal) => {
      try {
        let list: BookingNote[];
        let fetched: string | null = null;
        if (sourceKind === "ticket") {
          list = await fetchTicketNotes(bookingId, signal);
        } else {
          const data = await fetchBookingNotes(orderNumber, line, signal);
          list = data.notes;
          fetched = data.action_taken_by;
        }
        if (signal?.aborted) {
          return;
        }
        const sorted = withGuestForm(list, guestForm).sort((a, b) =>
          (a.created_at ?? "").localeCompare(b.created_at ?? ""),
        );
        setNotes(sorted);
        setFetchedActionBy(fetched);
        setLoadFailed(false);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        // 拉不到时保留已显示的内容；第一次就失败才提示。
        setLoadFailed(true);
      }
    },
    // guestForm 每次渲染都是新对象，只认里面的值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sourceKind,
      bookingId,
      orderNumber,
      line,
      guestForm?.body,
      guestForm?.submittedAt,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadNotes(controller.signal);
    const timer = setInterval(
      () => void loadNotes(controller.signal),
      NOTES_POLL_MS,
    );
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [loadNotes]);

  // 新消息到了滚到最底下。
  const noteCount = notes?.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [noteCount]);

  async function submit(kind: "staff_note" | "sms_out") {
    const body = text.trim();
    if (!body || submitting) {
      return;
    }
    const toGuest = kind === "sms_out";
    if (toGuest && !sendSms && !sendEmail) {
      setNotice({
        tone: "error",
        text: "Tick SMS or Email to send to the guest, or use Save note.",
      });
      return;
    }
    if (toGuest && sendSms && body.length > SMS_MAX) {
      setNotice({
        tone: "error",
        text: `This message is too long for SMS (${body.length.toLocaleString("en-US")} / ${SMS_MAX.toLocaleString("en-US")} characters). Shorten it, or untick “SMS to guest” and send it by email only.`,
      });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const payload: NoteCreate = {
        body,
        direction: kind,
        send_sms: toGuest && sendSms,
        send_email: toGuest && sendEmail,
      };
      const note =
        sourceKind === "ticket"
          ? await createTicketNote(bookingId, payload)
          : await createBookingNote(orderNumber, { ...payload, line });
      setText("");
      const missed: string[] = [];
      if (toGuest && sendSms && note.sms_status !== "sent") missed.push("SMS");
      if (toGuest && sendEmail && note.email_status !== "sent") {
        missed.push("email");
      }
      if (missed.length) {
        setNotice({
          tone: "warn",
          text: `Saved, but NOT delivered to the guest via ${missed.join(" / ")}. The guest has not received this message — please reach them another way.`,
        });
      }
      await loadNotes();
      // 表格的预览和处理状态跟着刷新（发出去后端会把这单记成已处理）。
      onChanged();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setNotice({
        tone: "error",
        text: `Not sent (${describeError(error)}). Your message has been kept — please try again.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleAction() {
    if (toggling) {
      return;
    }
    setToggling(true);
    setNotice(null);
    try {
      await toggleTakeAction(
        bookingId,
        sourceKind === "ticket" ? "tickets" : undefined,
      );
      // 接口回的是用户名，重拉一次拿显示名（和表格同一个口径）。
      await loadNotes();
      onChanged();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setNotice({
        tone: "error",
        text: `Could not update (${describeError(error)}). Please try again.`,
      });
    } finally {
      setToggling(false);
    }
  }

  const titleId = "conversation-title";
  const smsLength = describeSmsLength(text.trim());

  return (
    <Modal
      titleId={titleId}
      onDismiss={submitting ? undefined : onClose}
      panelClassName="flex max-h-[90vh] max-w-xl flex-col overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 bg-[#185FA5] px-5 py-3.5 text-white">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            Order {orderNumber}
          </h2>
          <p className="truncate text-sm text-white/80">{target.guestName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
          className="rounded px-1.5 text-2xl leading-none text-white/80 hover:text-white disabled:opacity-50"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-0.5 border-b border-stone-200 bg-stone-50 px-5 py-2.5 text-xs text-stone-600">
        <ContactLine
          dotClass="bg-orange-500"
          value={target.phone}
          missing="no phone on file"
          badge={target.smsBadge}
        />
        <ContactLine
          dotClass="bg-blue-500"
          value={target.email}
          missing="no email on file"
          badge={target.emailBadge}
        />
      </div>

      <div
        ref={listRef}
        className="flex min-h-40 flex-1 flex-col gap-2.5 overflow-y-auto bg-stone-100 px-5 py-4"
      >
        {notes === null ? (
          <p className="m-auto text-sm text-stone-500">
            {loadFailed ? "Could not load messages. Retrying…" : "Loading…"}
          </p>
        ) : notes.length === 0 ? (
          <p className="m-auto text-sm text-stone-500">No messages yet.</p>
        ) : (
          notes.map((note) => <NoteBubble key={note.id} note={note} />)
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-stone-200 px-5 py-3.5">
        {notice ? (
          <p
            role="alert"
            className={cn(
              "rounded-md px-3 py-2 text-sm",
              notice.tone === "error"
                ? "bg-[#FCEBEB] text-[#A32D2D]"
                : "bg-amber-50 text-amber-800",
            )}
          >
            {notice.text}
          </p>
        ) : null}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write a note or message to guest…"
          rows={3}
          className="field-sizing-content max-h-60 min-h-[70px] w-full resize-none rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
        />
        {sendSms ? (
          <p
            className={cn(
              "text-xs",
              smsLength.over ? "font-semibold text-red-600" : "text-stone-500",
            )}
          >
            {smsLength.text}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-sm text-stone-700">
            <ChannelCheckbox
              label="SMS to guest"
              dotClass="bg-orange-500"
              checked={smsChecked}
              disabled={!hasPhone}
              onChange={setSmsChecked}
            />
            <ChannelCheckbox
              label="Email to guest"
              dotClass="bg-blue-500"
              checked={emailChecked}
              disabled={!hasEmail}
              onChange={setEmailChecked}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              title="Save as internal note — not visible to guest"
              onClick={() => void submit("staff_note")}
              disabled={submitting || !text.trim()}
              className={SECONDARY_BUTTON_CLASS}
            >
              Save note
            </button>
            <button
              type="button"
              title="Send to guest via the selected channels"
              onClick={() => void submit("sms_out")}
              disabled={submitting || !text.trim()}
              className={PRIMARY_BUTTON_CLASS}
            >
              {submitting ? "Sending…" : "Send →"}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggleAction()}
          disabled={toggling || notes === null}
          className={cn(
            "mt-1 rounded-md border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
            actionBy
              ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
              : "border-emerald-600 text-emerald-700 hover:bg-emerald-50",
          )}
        >
          {actionBy ? `✓ Actioned by ${actionBy}` : "✓ Mark as actioned"}
        </button>
      </div>
    </Modal>
  );
}

function NoteBubble({ note }: { note: BookingNote }) {
  const inbound = isInbound(note.direction);
  const { label, className } = noteLabel(note);
  const meta = [label];
  if (!inbound && note.author_username) {
    meta.push(note.author_username);
  }
  if (note.created_at) {
    meta.push(note.created_at);
  }
  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col gap-1",
        inbound ? "self-start" : "self-end",
      )}
    >
      <div
        className={cn(
          "rounded-xl px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap",
          inbound
            ? "rounded-bl-sm border border-stone-200 bg-white text-stone-800"
            : note.direction === "staff_note"
              ? "rounded-br-sm border border-amber-200 bg-amber-50 text-stone-800"
              : "rounded-br-sm bg-[#185FA5] text-white",
        )}
      >
        {note.body}
      </div>
      <span
        className={cn(
          "text-[11px]",
          inbound ? "self-start" : "self-end",
          "text-stone-500",
        )}
      >
        <span className={cn("font-semibold", className)}>{meta[0]}</span>
        {meta.slice(1).map((part, index) => (
          <span key={index}> · {part}</span>
        ))}
      </span>
    </div>
  );
}

function ContactLine({
  dotClass,
  value,
  missing,
  badge,
}: {
  dotClass: string;
  value: string;
  missing: string;
  badge: ContactBadge | null;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 rounded-full", dotClass)} />
      {value.trim() ? (
        <>
          <span className="text-stone-800">{value}</span>
          {badge ? (
            <span
              className={cn(
                "font-semibold",
                badge.tone === "good" && "text-emerald-600",
                badge.tone === "bad" && "text-red-600",
                badge.tone === "muted" && "text-stone-400",
              )}
            >
              {badge.text}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-red-600">{missing}</span>
      )}
    </span>
  );
}

function ChannelCheckbox({
  label,
  dotClass,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  dotClass: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden className={cn("size-2 rounded-full", dotClass)} />
      {label}
    </label>
  );
}
