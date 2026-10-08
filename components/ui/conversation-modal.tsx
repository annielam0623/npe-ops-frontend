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

import { ModalShell } from "@/components/tracking-ui/modal-shell";

/** 弹窗开着时每 20 秒重拉一次对话（与旧页面一致）。 */
const NOTES_POLL_MS = 20_000;

export interface ContactBadge {
  text: string;
  tone: "good" | "bad" | "muted";
}

/**
 * 对话从哪取：
 * - order：按订单号（bookings 表，早班页带 line=morning）。readAllLines：读的时候不带 line（看这单所有线的对话），
 *   写的时候照样带 line —— Tour 页就是这样（同旧页面：读不分线、写记 tour）；
 * - ticket：按门票行 id（tickets_reminders 表，?source=tickets）。
 */
export type ConversationSource =
  | { kind: "order"; line?: NoteLine; readAllLines?: boolean }
  | { kind: "ticket" };

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

/**
 * 三个旧 tracking 页的对话弹窗各长各的（Annie 2026-10-07：和旧版一模一样）：
 * - morning：早班页，深色（tracking_morning.html 的 .notes-*）；
 * - tickets：门票页，白底绿头，Take Action 是标题下面一行勾选框（tracking_tickets.html）；
 * - tour：Tour 页，白底绿头，底部 ✓ Mark as actioned 按钮（tracking_tour.html）。
 */
export type ConversationTheme = "morning" | "tickets" | "tour";

interface DirectionStyle {
  label: string;
  color: string;
  /** 气泡底色 / 边框（只有门票页按方向分色）。 */
  bubble?: string;
  /** 元信息前面的渠道小圆点（门票 / Tour 页）。 */
  dot?: string;
}

const MORNING_LABELS: Record<string, DirectionStyle> = {
  staff_note: { label: "★ Note", color: "#d4a72c" },
  sms_out: { label: "SMS sent", color: "#6fbf8b" },
  email_out: { label: "Email sent", color: "#6fb6d9" },
  sms_in: { label: "Guest via SMS", color: "#e8a87c" },
  email_in: { label: "Guest via Email", color: "#8ab4f8" },
  guest_reply: { label: "Guest", color: "#a0c0e0" },
};

const TOUR_LABELS: Record<string, DirectionStyle> = {
  staff_note: { label: "★ Note", color: "#856404" },
  sms_out: { label: "SMS sent", color: "#155724", dot: "#f97316" },
  email_out: { label: "Email sent", color: "#0c5460", dot: "#3b82f6" },
  sms_in: { label: "Guest via SMS", color: "#9a3412", dot: "#f97316" },
  email_in: { label: "Guest via Email", color: "#1e40af", dot: "#3b82f6" },
  guest_reply: { label: "Guest", color: "#1a3a5c" },
};

const TICKETS_LABELS: Record<string, DirectionStyle> = {
  staff_note: {
    label: "★ Note",
    color: "#856404",
    bubble: "bg-[#fffbea] border-[#f0d080]",
  },
  sms_out: {
    label: "SMS sent",
    color: "#155724",
    bubble: "bg-[#d4edda] border-[#b7ddc4]",
    dot: "#f97316",
  },
  email_out: {
    label: "Email sent",
    color: "#0c5460",
    bubble: "bg-[#d1ecf1] border-[#a8d8e1]",
    dot: "#3b82f6",
  },
  sms_in: {
    label: "SMS",
    color: "#9a3412",
    bubble: "bg-[#fff7ed] border-[#fcd9b0]",
    dot: "#f97316",
  },
  email_in: {
    label: "Email",
    color: "#1e40af",
    bubble: "bg-[#eff6ff] border-[#bfdbfe]",
    dot: "#3b82f6",
  },
  guest_reply: {
    label: "webPage",
    color: "#1a3a5c",
    bubble: "bg-[#e8f4fd] border-[#b3d9f7]",
  },
};

const LABELS: Record<ConversationTheme, Record<string, DirectionStyle>> = {
  morning: MORNING_LABELS,
  tickets: TICKETS_LABELS,
  tour: TOUR_LABELS,
};

/** 发给客人的消息带投递结果时，标签写结果：不是 sent 一律算没发出去。 */
function noteLabel(
  note: BookingNote,
  theme: ConversationTheme,
): DirectionStyle {
  const base = LABELS[theme][note.direction] ?? {
    label: note.direction,
    color: theme === "morning" ? "#8aa9c8" : "#333",
    bubble: "bg-[#f0f0f0] border-[#ddd]",
  };
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
      ...base,
      label: parts.join(", "),
      color: failed
        ? theme === "morning"
          ? "#e74c3c"
          : "#dc3545"
        : base.color,
    };
  }
  return base;
}

/** 各页的配色，值全部照旧模板。 */
const SKIN = {
  morning: {
    overlay: "bg-black/55",
    panel:
      "flex max-h-[85vh] w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-[12px] border border-white/[.12] bg-[#1a2f4a]",
    head: "bg-[#185FA5]",
    sub: "text-[#cfe4f7]",
    close: "text-[#cfe4f7] hover:text-white",
    body: "max-h-[420px] bg-[#0f2035]",
    empty: "text-[#5a7a9a]",
    meta: "text-[#6f8fae]",
    foot: "border-t border-white/[.08] bg-[#1a2f4a]",
    textarea:
      "rounded-lg border border-white/15 bg-[#0f2035] text-[#e0eaf6] placeholder:text-[#5a7a9a] focus:border-[#185FA5]",
    check: "gap-1 text-[#c8ddf0]",
    save: "border border-white/15 bg-[#1e3a5f] font-normal text-[#c8ddf0] hover:bg-[#24466f] hover:text-white disabled:hover:bg-[#1e3a5f] disabled:hover:text-[#c8ddf0]",
    send: "border border-[#185FA5] bg-[#185FA5] font-medium text-white hover:bg-[#1470c4] disabled:hover:bg-[#185FA5]",
    info: "text-[#8aa9c8]",
    none: "text-[#ff6b6b]",
    badge: {
      good: "font-semibold text-[#2ecc71]",
      bad: "font-semibold text-[#e74c3c]",
      muted: "font-semibold text-[#8aa9c8]",
    },
    error:
      "border border-[rgba(231,76,60,.40)] bg-[rgba(231,76,60,.14)] text-[#f5a3a3]",
    warn: "border border-[rgba(196,122,18,.5)] bg-[rgba(196,122,18,.15)] text-[#f5c98a]",
  },
  tour: {
    overlay: "bg-black/45",
    panel:
      "flex max-h-[85vh] w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-[12px] bg-white",
    head: "bg-[#2F7851]",
    sub: "text-[#D5F0D8]",
    close: "text-[#D5F0D8] hover:text-white",
    body: "max-h-[380px] bg-[#f8f9fa]",
    empty: "text-[#aaa]",
    meta: "text-[#aaa]",
    foot: "border-t border-[#eee] bg-white",
    textarea:
      "rounded-lg border border-[#dee2e6] bg-white bg-[length:16px_16px] bg-[position:right_3px_bottom_3px] bg-no-repeat text-[#1f2d25]",
    check: "gap-1 text-[#1f2d25]",
    save: "border border-[#dee2e6] bg-[#f8f9fa] font-normal text-[#1f2d25]",
    send: "border border-transparent bg-[#2F7851] font-medium text-white",
    info: "text-[#666]",
    none: "text-[#b00]",
    badge: {
      good: "font-semibold text-[#2F7851]",
      bad: "font-semibold text-[#dc3545]",
      muted: "font-semibold text-[#888]",
    },
    error: "bg-[#FCEBEB] text-[#A32D2D]",
    warn: "bg-[#fff8e1] text-[#856404]",
  },
} as const;

/** 门票页和 Tour 页长得几乎一样，差别写在用到的地方。 */
function skinOf(theme: ConversationTheme) {
  return theme === "morning" ? SKIN.morning : SKIN.tour;
}

/** Tour / 门票页的输入框右下角有一个斜纹拖拽角（旧模板里的内联 SVG）。 */
const GRIP_IMAGE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M14 2 L2 14 M14 7 L7 14 M14 12 L12 14' stroke='%236c8f6f' stroke-width='1.6' fill='none' stroke-linecap='round'/></svg>\")";

type Notice = { tone: "error" | "warn"; text: string } | null;

/**
 * 一单的对话：看全部往来、写内部备注、发短信 / 邮件给客人、标记已处理。
 * ⚠️ 「Send →」会**真实发送**给客人。
 */
export function ConversationModal({
  theme,
  target,
  source,
  onClose,
  onChanged,
  onUnauthorized,
}: {
  /** 照哪一个旧页面的样子画（三页的对话窗各不相同）。 */
  theme: ConversationTheme;
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
  const readLine =
    source.kind === "order" && source.readAllLines ? undefined : line;
  // 处理人以表格行为准的情况：ticket 来源接口不回；readAllLines 时接口回的是这单 id 最大那行
  // （常是早班行），而 Mark as actioned 改的是本行（target.bookingId），用接口的会显示 / 清掉别人的标记。
  const actionByFromRow = source.kind === "ticket" || !!source.readAllLines;
  const [notes, setNotes] = useState<BookingNote[] | null>(null);
  /** 接口回的处理人（order 来源）；null = 接口不回，用表格行里的。 */
  const [fetchedActionBy, setFetchedActionBy] = useState<string | null>(null);
  /** 刚点过 Mark as actioned、表格行还没重拉回来时，先显示开关接口回的结果。 */
  const [toggled, setToggled] = useState<{ from: string; to: string } | null>(
    null,
  );
  const rowActionBy =
    toggled && toggled.from === target.actionTakenBy
      ? toggled.to
      : target.actionTakenBy;
  const actionBy = actionByFromRow
    ? rowActionBy
    : (fetchedActionBy ?? target.actionTakenBy);
  // 表格行变了就不再用临时结果，免得之后别人改回原值时又显示成旧的。
  useEffect(() => {
    if (toggled && toggled.from !== target.actionTakenBy) {
      setToggled(null);
    }
  }, [toggled, target.actionTakenBy]);
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
          const data = await fetchBookingNotes(orderNumber, readLine, signal);
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
      readLine,
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
      const result = await toggleTakeAction(
        bookingId,
        sourceKind === "ticket" ? "tickets" : undefined,
      );
      // 接口回的是用户名；表格行重拉回来（换成显示名）后以表格为准。
      setToggled({
        from: target.actionTakenBy,
        to: result.action_taken_by ?? "",
      });
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
  const skin = skinOf(theme);
  const dark = theme === "morning";

  return (
    <ModalShell
      titleId={titleId}
      onDismiss={submitting ? undefined : onClose}
      overlayClassName={skin.overlay}
      panelClassName={skin.panel}
    >
      <div
        className={cn("flex items-center gap-2.5 px-[18px] py-3.5", skin.head)}
      >
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[14px] font-semibold text-white">
            Order {orderNumber}
          </h2>
          <p className={cn("truncate text-[12px]", skin.sub)}>
            {target.guestName}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
          title="Close"
          className={cn(
            "cursor-pointer text-[20px] leading-none disabled:opacity-50",
            skin.close,
          )}
        >
          ×
        </button>
      </div>

      {theme === "tickets" ? (
        // 门票页：Take Action 是标题下面一行勾选框（旧页面 #nmActionCb）。
        <div className="flex items-center gap-2 border-b border-[#eee] bg-[#f8f9fa] px-3.5 py-2">
          <input
            id="conversation-action"
            type="checkbox"
            checked={!!actionBy}
            disabled={toggling || notes === null}
            onChange={() => void toggleAction()}
            className="size-3.5 cursor-pointer accent-[#2F7851] disabled:cursor-not-allowed"
          />
          <label
            htmlFor="conversation-action"
            className={cn(
              "cursor-pointer text-[12px]",
              actionBy ? "font-semibold text-[#28a745]" : "text-[#555]",
            )}
          >
            {actionBy ? `✓ Actioned by ${actionBy}` : "Take Action"}
          </label>
        </div>
      ) : null}

      <div
        ref={listRef}
        className={cn(
          "flex min-h-[200px] flex-1 flex-col gap-2.5 overflow-y-auto p-3.5",
          skin.body,
          theme === "tickets" && "max-h-[360px]",
        )}
      >
        {notes === null ? (
          <p className={cn("py-5 text-center text-[13px]", skin.empty)}>
            {loadFailed ? "Could not load messages. Retrying…" : "Loading…"}
          </p>
        ) : notes.length === 0 ? (
          <p className={cn("py-5 text-center text-[13px]", skin.empty)}>
            No messages yet.
          </p>
        ) : (
          notes.map((note) => (
            <NoteBubble key={note.id} note={note} theme={theme} />
          ))
        )}
      </div>

      <div className={cn("px-3.5 py-3", skin.foot)}>
        {notice ? (
          <p
            role="alert"
            className={cn(
              "mb-2 rounded-md px-3 py-2 text-[12px]",
              notice.tone === "error" ? skin.error : skin.warn,
            )}
          >
            {notice.text}
          </p>
        ) : null}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            theme === "tickets"
              ? "Write a note or reply to guest..."
              : theme === "tour"
                ? "Write a note or message to guest..."
                : "Write a note or message to guest…"
          }
          rows={3}
          style={dark ? undefined : { backgroundImage: GRIP_IMAGE }}
          className={cn(
            "block min-h-[70px] w-full resize-y px-2.5 py-2 font-[inherit] text-[13px] outline-none",
            skin.textarea,
          )}
        />
        {sendSms ? (
          <p
            className={cn(
              "mt-1 text-[11px]",
              smsLength.over ? "font-semibold text-[#c0392b]" : "text-[#888]",
            )}
          >
            {smsLength.text}
          </p>
        ) : null}
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center",
            dark ? "gap-2.5" : "gap-2",
          )}
        >
          <ChannelCheckbox
            label="SMS to guest"
            dot="#f97316"
            className={skin.check}
            checked={smsChecked}
            disabled={!hasPhone}
            onChange={setSmsChecked}
          />
          <ChannelCheckbox
            label="Email to guest"
            dot="#3b82f6"
            className={skin.check}
            checked={emailChecked}
            disabled={!hasEmail}
            onChange={setEmailChecked}
          />
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              title="Save as internal note — not visible to guest"
              onClick={() => void submit("staff_note")}
              disabled={submitting || !text.trim()}
              className={cn(
                "cursor-pointer rounded-md px-3.5 py-1.5 text-[12px] disabled:cursor-default disabled:opacity-50",
                skin.save,
              )}
            >
              {theme === "tickets" ? "★ Save note" : "Save note"}
            </button>
            <button
              type="button"
              title={
                dark
                  ? "Send to guest via the selected channels"
                  : "Send to guest via selected channels"
              }
              onClick={() => void submit("sms_out")}
              disabled={submitting || !text.trim()}
              className={cn(
                "cursor-pointer rounded-md px-3.5 py-1.5 text-[12px] disabled:cursor-default disabled:opacity-50",
                skin.send,
              )}
            >
              {submitting ? "Sending…" : "Send →"}
            </button>
          </div>
        </div>
        {/* 收件方式常驻显示（同旧页面 #notesChannelInfo），和表格的 SMS / Email 两列同源。 */}
        <div
          className={cn(
            "mt-1.5 text-[11px] leading-[1.7] break-all",
            skin.info,
          )}
        >
          <ContactLine
            theme={theme}
            dot="#f97316"
            value={target.phone}
            missing="no phone on file"
            badge={target.smsBadge}
          />
          <ContactLine
            theme={theme}
            dot="#3b82f6"
            value={target.email}
            missing="no email on file"
            badge={target.emailBadge}
          />
        </div>
        {theme === "tickets" ? null : (
          <div
            className={cn(
              "mt-2 border-t pt-2",
              dark ? "border-white/[.08]" : "border-[#f0f0f0]",
            )}
          >
            <button
              type="button"
              onClick={() => void toggleAction()}
              disabled={toggling || notes === null}
              className={cn(
                "w-full cursor-pointer rounded-md border px-3.5 py-1.5 font-[inherit] text-[12px] font-medium transition-colors disabled:cursor-default disabled:opacity-55",
                dark
                  ? actionBy
                    ? "border-[#1a6b3a] bg-[#1a6b3a] text-white hover:bg-[#145530]"
                    : "border-[#2ecc71] bg-[#1e3a5f] text-[#2ecc71] hover:bg-[#24466f]"
                  : actionBy
                    ? "border-[#9ED3A9] bg-[#D5F0D8] text-[#2F7851]"
                    : "border-[#9ED3A9] bg-[#f8f9fa] text-[#2F7851] hover:border-[#2F7851] hover:bg-[#2F7851] hover:text-white",
              )}
            >
              {actionBy ? `✓ Actioned by ${actionBy}` : "✓ Mark as actioned"}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

const OUTBOUND = new Set(["staff_note", "sms_out", "email_out"]);

function NoteBubble({
  note,
  theme,
}: {
  note: BookingNote;
  theme: ConversationTheme;
}) {
  const style = noteLabel(note, theme);
  const inbound = isInbound(note.direction);
  // 气泡靠哪边：早班页按「是不是客人发的」，门票 / Tour 页按方向表（不认识的方向靠左）。
  const right = theme === "morning" ? !inbound : OUTBOUND.has(note.direction);
  // 署名：早班页客人那边不写；门票页客人那边一律是 'guest'，不写；Tour 页照写（同各自旧页面）。
  const showAuthor =
    !!note.author_username &&
    (theme === "morning"
      ? !inbound
      : theme === "tickets"
        ? note.author_username !== "guest"
        : true);
  const meta: string[] = [];
  if (showAuthor) meta.push(note.author_username);
  if (note.created_at) meta.push(note.created_at);

  const bubbleClass =
    theme === "morning"
      ? right
        ? "rounded-[10px_0_10px_10px] border border-white/10 bg-[#17314f] text-[#e0eaf6]"
        : "rounded-[0_10px_10px_10px] border border-[rgba(122,179,224,.28)] bg-[#24425f] text-[#e0eaf6]"
      : theme === "tickets"
        ? cn(
            "border-[0.5px] text-[#333]",
            right ? "rounded-[10px_0_10px_10px]" : "rounded-[0_10px_10px_10px]",
            style.bubble ?? "border-[#ddd] bg-[#f0f0f0]",
          )
        : right
          ? "rounded-[10px_0_10px_10px] border border-[#dee2e6] bg-white text-[#212529]"
          : "rounded-[0_10px_10px_10px] border border-[#cdd8e3] bg-[#f0f4f8] text-[#212529]";

  return (
    <div
      className={cn(
        "flex max-w-[88%] flex-col",
        theme === "tickets" ? "gap-0.5" : "gap-[3px]",
        right ? "self-end" : "self-start",
      )}
    >
      <div
        className={cn(
          "px-3 py-[9px] text-[13px] leading-[1.5] break-words whitespace-pre-wrap",
          bubbleClass,
        )}
      >
        {note.body}
      </div>
      <div
        className={cn(
          "px-1 text-[11px]",
          theme === "morning" ? "text-[#6f8fae]" : "text-[#aaa]",
          right && "text-right",
        )}
      >
        {style.dot ? (
          <span
            aria-hidden
            className="mr-[3px] inline-block size-[7px] rounded-full align-middle"
            style={{ background: style.dot }}
          />
        ) : null}
        <span className="font-semibold" style={{ color: style.color }}>
          {style.label}
        </span>
        {meta.map((part, index) => (
          <span key={index}> · {part}</span>
        ))}
      </div>
    </div>
  );
}

function ContactLine({
  theme,
  dot,
  value,
  missing,
  badge,
}: {
  theme: ConversationTheme;
  dot: string;
  value: string;
  missing: string;
  badge: ContactBadge | null;
}) {
  const skin = skinOf(theme);
  return (
    <div>
      <span
        aria-hidden
        className="mr-1.5 inline-block size-2 rounded-full align-middle"
        style={{ background: dot }}
      />
      {value.trim() ? (
        <>
          {value}
          {badge ? (
            <span
              className={
                theme === "tickets"
                  ? cn(
                      "text-[12px] font-bold",
                      badge.tone === "bad"
                        ? "text-[#dc3545]"
                        : "text-[#166534]",
                    )
                  : skin.badge[badge.tone]
              }
            >
              {" "}
              {badge.text}
            </span>
          ) : null}
        </>
      ) : (
        <span className={skin.none}>{missing}</span>
      )}
    </div>
  );
}

function ChannelCheckbox({
  label,
  dot,
  className,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  dot: string;
  className: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center text-[12px]",
        className,
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className="mr-0.5 inline-block size-2 rounded-full"
        style={{ background: dot }}
      />
      {label}
    </label>
  );
}
