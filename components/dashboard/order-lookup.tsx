"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  formatCheckinTime,
  formatGuestViewed,
  formatYmd,
  smsStatusOf,
  emailStatusOf,
} from "@/components/morning-tracking/config";
import {
  emailLabel as ticketsEmail,
  formatSubmitted,
  productLabel,
  smsLabel as ticketsSms,
} from "@/components/tickets-tracking/config";
import {
  displayName,
  emailLabel as tourEmail,
  mtlvCells,
  smsLabel as tourSms,
} from "@/components/tour-tracking/config";
import { PageLink } from "@/components/ui/page-link";
import { describeError, isStatus } from "@/lib/api-errors";
import { isInbound } from "@/lib/channels";
import {
  type LaneResult,
  lookupOrder,
  type OrderLookup as LookupResult,
} from "@/lib/order-lookup-api";
import { cn } from "@/lib/utils";
import type {
  MorningTrackingRow,
  TicketsTrackingRow,
  TourTrackingRow,
} from "@/types";

type State =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "not-found"; query: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; result: LookupResult };

/** 深色底上的字色（dashboard 用的是深色，tracking 页的浅底配色在这里看不清）。 */
type Tone = "good" | "warn" | "bad" | "info" | "purple" | "muted" | "plain";
const TONE_CLASS: Record<Tone, string> = {
  good: "text-[#4ade80]",
  warn: "text-[#fbbf24]",
  bad: "text-[#f87171]",
  info: "text-[#60a5fa]",
  purple: "text-[#a78bfa]",
  muted: "text-white/45",
  plain: "text-[#f8fafc]",
};

/**
 * dashboard 的订单查询窗口（Annie 2026-10-14）：输入单号 → 订单详情 + 这单在三个 Tracking 页上的现状。
 * 只读；改状态、回消息都去对应的 Tracking 页（每块右上角的链接，带日期和单号）。
 */
export function OrderLookup({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function search(event: FormEvent) {
    event.preventDefault();
    const query = input.trim();
    if (!query) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "loading", query });
    try {
      const result = await lookupOrder(query, controller.signal);
      if (controller.signal.aborted) return;
      setState(
        result ? { kind: "ready", result } : { kind: "not-found", query },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      setState({ kind: "error", message: describeError(error) });
    }
  }

  function clear() {
    controllerRef.current?.abort();
    setInput("");
    setState({ kind: "idle" });
  }

  return (
    <section
      aria-label="Order lookup"
      data-order-lookup
      className="mb-[18px] rounded-[16px] border border-white/10 bg-white/[.032] px-[18px] py-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold">Order lookup</h2>
          <p className="mt-0.5 text-[12.5px] text-white/50">
            Enter an order # to see the booking and where it stands in Tour
            Confirmation, Ticket Reminder and Morning Pickup tracking.
          </p>
        </div>
        <form onSubmit={search} className="flex items-center gap-2">
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Order #"
            aria-label="Order number"
            spellCheck={false}
            autoComplete="off"
            className="h-[34px] w-[220px] rounded-[9px] border border-white/15 bg-white/[.05] px-3 text-[13px] text-[#f8fafc] outline-none placeholder:text-white/35 focus:border-white/40 max-[480px]:w-[160px] [&::-webkit-search-cancel-button]:appearance-none"
          />
          {/* 查询不是提交：不用蓝色（CLAUDE.md 蓝色只给提交键），照 dashboard 快捷卡的 Track 键。 */}
          <button
            type="submit"
            disabled={!input.trim() || state.kind === "loading"}
            className="h-[34px] rounded-[9px] border border-white/[.13] px-4 text-[13px] font-semibold text-white/75 transition hover:border-white/[.22] hover:bg-white/[.07] hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Search
          </button>
          {state.kind !== "idle" && (
            <button
              type="button"
              onClick={clear}
              className="h-[34px] px-1 text-[12.5px] text-white/45 hover:text-white/80"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      <LookupBody state={state} />
    </section>
  );
}

function LookupBody({ state }: { state: State }) {
  switch (state.kind) {
    case "idle":
      return null;
    case "loading":
      return <Note>Looking up {state.query}…</Note>;
    case "not-found":
      return (
        <Note tone="warn">
          No order found for “{state.query}”. Check the order # (Rezdy or CHD
          number).
        </Note>
      );
    case "error":
      return <Note tone="bad">Lookup failed: {state.message}</Note>;
    case "ready":
      return <LookupResultView result={state.result} />;
  }
}

function Note({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <p className={cn("mt-3 text-[13px]", TONE_CLASS[tone])} data-lookup-note>
      {children}
    </p>
  );
}

// ── 结果 ────────────────────────────────────────────────────────────────────

function LookupResultView({ result }: { result: LookupResult }) {
  const { order, date } = result;
  const on = order.order_number;
  const driver = [
    order.ops.driver,
    order.ops.vehicle_no && `Bus ${order.ops.vehicle_no}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const pickup = [order.product.pickup_time, order.product.pickup_location]
    .filter(Boolean)
    .join(" · ");

  const lanes = [result.tour, result.tickets, result.morning];
  const found = lanes.some((l) => l?.kind === "ok" && l.rows.length > 0);
  const anyError = lanes.some((l) => l?.kind === "error");

  return (
    <div className="mt-4 grid gap-3.5" data-lookup-result>
      {/* 订单 */}
      <div className="rounded-[12px] border border-white/10 bg-white/[.025] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className="text-[16px] font-bold tracking-[.01em]"
            data-lookup-order
          >
            {on}
          </span>
          <span
            className={cn(
              "text-[13px] font-semibold",
              orderStatusTone(order.status),
            )}
          >
            {order.status}
          </span>
          <span className="text-[13px] text-white/70">
            {order.product.name || order.product.code || "—"}
          </span>
          <PageLink
            href={`/orders/${encodeURIComponent(on)}`}
            className="ml-auto text-[12.5px] font-semibold text-white/60 hover:text-white"
          >
            Order details →
          </PageLink>
        </div>
        <dl className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-5 gap-y-2 text-[13px]">
          <Field label="Tour date">
            {[
              date ? usDate(date) : order.product.tour_date,
              order.product.tour_time,
            ]
              .filter((v) => v && v !== "—")
              .join(" · ") || "—"}
          </Field>
          <Field label="Guest">{order.guest.name || "—"}</Field>
          <Field label="Pax">{order.guest.pax ?? "—"}</Field>
          <Field label="Phone">{order.guest.phone || "—"}</Field>
          <Field label="Email">{order.guest.email || "—"}</Field>
          <Field label="Pickup">{pickup || "—"}</Field>
          <Field label="Driver / bus">{driver || "—"}</Field>
          <Field label="Confirmation #">
            {order.ops.confirmation_no || "—"}
          </Field>
          <Field label="Agent">{order.ops.agent_name || "—"}</Field>
        </dl>
        {order.product.item_count > 1 && (
          <p className="mt-2 text-[12px] text-[#fbbf24]">
            This order has {order.product.item_count} products; the date above
            is the first one, and tracking below is for that date only.
          </p>
        )}
      </div>

      {/* 运营状态 */}
      {!date ? (
        <Note tone="warn">
          This order has no tour date, so it can’t be matched to a tracking
          list.
        </Note>
      ) : (
        <>
          {result.tour && (
            <LaneBlock
              title="Tour Confirmation"
              href={trackHref("/tour-confirmation/tracking", date, on)}
              lane={result.tour}
              render={(r) => <TourStatus row={r} />}
            />
          )}
          {result.tickets && (
            <LaneBlock
              title="Ticket Reminder"
              href={trackHref("/tickets-reminder/tracking", date, on)}
              lane={result.tickets}
              render={(r) => <TicketsStatus row={r} />}
            />
          )}
          {result.morning && (
            <LaneBlock
              title="Morning Pickup"
              href={trackHref("/morning-pickup/tracking", date, on)}
              lane={result.morning}
              render={(r) => <MorningStatus row={r} />}
            />
          )}
          {!found && !anyError && (
            <Note>
              Not on any tracking list for {formatYmd(date)} yet — nothing has
              been sent or uploaded for this order.
            </Note>
          )}
        </>
      )}
    </div>
  );
}

/** "2026-10-21" → "10/21/2026"（同订单详情接口的写法；老单库里存的是 YYYY-MM-DD 字符串）。 */
function usDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${m}/${d}/${y}`;
}

function trackHref(path: string, date: string, orderNumber: string): string {
  return `${path}?date=${date}&q=${encodeURIComponent(orderNumber)}`;
}

function orderStatusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith("cancel")) return TONE_CLASS.bad;
  if (s.startsWith("confirm")) return TONE_CLASS.good;
  return TONE_CLASS.warn;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold tracking-[.05em] text-white/40 uppercase">
        {label}
      </dt>
      <dd className="[overflow-wrap:anywhere] text-white/85">{children}</dd>
    </div>
  );
}

/** 一条线（Tour / Tickets / Morning）：这天表里没有这单就只写一行灰字，不占大块。 */
function LaneBlock<Row extends { id: number }>({
  title,
  href,
  lane,
  render,
}: {
  title: string;
  href: string;
  lane: LaneResult<Row>;
  render: (row: Row) => ReactNode;
}) {
  if (lane.kind === "ok" && lane.rows.length === 0) {
    return (
      <p className="text-[12.5px] text-white/40" data-lane={title}>
        {title}: not on this day’s list.
      </p>
    );
  }
  return (
    <div
      className="rounded-[12px] border border-white/10 bg-white/[.025] px-4 py-3"
      data-lane={title}
    >
      <div className="mb-2 flex items-baseline gap-3">
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        <PageLink
          href={href}
          className="ml-auto text-[12.5px] font-semibold text-white/60 hover:text-white"
        >
          Open tracking →
        </PageLink>
      </div>
      {lane.kind === "error" ? (
        <p className="text-[13px] text-[#f87171]">
          Couldn’t load this tracking list: {lane.message}
        </p>
      ) : (
        <div className="grid gap-3">
          {lane.rows.map((row) => (
            <div key={row.id}>{render(row)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-5 gap-y-2 text-[13px]">
      {children}
    </dl>
  );
}

function Fact({
  label,
  tone = "plain",
  wide = false,
  children,
}: {
  label: string;
  tone?: Tone;
  /** 占满一整行（长地址）。 */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-full")} data-fact={label}>
      <dt className="text-[10.5px] font-semibold tracking-[.05em] text-white/40 uppercase">
        {label}
      </dt>
      <dd
        className={cn("font-medium [overflow-wrap:anywhere]", TONE_CLASS[tone])}
      >
        {children}
      </dd>
    </div>
  );
}

const deliveryTone = (tone: string): Tone =>
  tone === "good"
    ? "good"
    : tone === "bad"
      ? "bad"
      : tone === "none"
        ? "muted"
        : "plain";

// ── Tour Confirmation ──

const TOUR_STATUS: Record<string, { label: string; tone: Tone }> = {
  yes: { label: "YES", tone: "good" },
  modify_req: { label: "Modify requested", tone: "warn" },
  modified: { label: "Modified", tone: "purple" },
  pending: { label: "Pending (no reply yet)", tone: "info" },
  cancel: { label: "Cancel", tone: "bad" },
};

function TourStatus({ row }: { row: TourTrackingRow }) {
  const status = row.confirmation_status || "pending";
  const s = TOUR_STATUS[status] ?? { label: status, tone: "plain" as Tone };
  const sms = tourSms(row.sms_status);
  const email = tourEmail(row);
  const lunch = row.lunch_turkey + row.lunch_veggie + row.lunch_beef;
  const mtlv = mtlvCells(row);
  return (
    <>
      <Facts>
        <Fact label="Guest reply" tone={s.tone}>
          {s.label}
        </Fact>
        <Fact label="Guest">{displayName(row)}</Fact>
        <Fact label="SMS" tone={deliveryTone(sms.tone)}>
          {sms.label}
        </Fact>
        <Fact label="Email" tone={deliveryTone(email.tone)}>
          {email.label}
        </Fact>
        <Fact label="Submitted" tone={row.submitted_at ? "plain" : "muted"}>
          {row.submitted_at || "—"}
          {row.submission_count > 1 ? ` (${row.submission_count}×)` : ""}
        </Fact>
        {lunch > 0 && (
          <Fact label="Lunch">
            🦃 {row.lunch_turkey} 🥗 {row.lunch_veggie} 🥩 {row.lunch_beef}
          </Fact>
        )}
        {mtlv.kind !== "none" && (
          <Fact
            label="MTLV tickets"
            tone={
              mtlv.kind === "cancel"
                ? "bad"
                : mtlv.kind === "waiting"
                  ? "warn"
                  : mtlv.sent
                    ? "good"
                    : "warn"
            }
          >
            {mtlv.kind === "cancel"
              ? "Cancelled"
              : mtlv.kind === "waiting"
                ? "Waiting for guest"
                : `${mtlv.qty} · ${mtlv.sent ? "sent" : "not sent yet"}`}
          </Fact>
        )}
        <MessagesFact
          noteCount={row.notes_count + row.wa_count}
          needsAction={row.notes_unhandled || row.wa_unhandled}
          handledBy={row.action_taken_by}
        />
      </Facts>
      <LatestMessage row={row} guestNote={row.notes} />
    </>
  );
}

// ── Ticket Reminder ──

const TICKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  yes: { label: "YES", tone: "good" },
  pending: { label: "Pending (no reply yet)", tone: "warn" },
  reschedule_req: { label: "Reschedule requested", tone: "warn" },
  cancel: { label: "Cancel", tone: "bad" },
};

function TicketsStatus({ row }: { row: TicketsTrackingRow }) {
  const status = row.confirmation_status || "pending";
  const s = TICKET_STATUS[status] ?? { label: status, tone: "plain" as Tone };
  const sms = ticketsSms(row.sms_status);
  const email = ticketsEmail(row);
  const time = [
    row.checkin_time && `Check-in ${row.checkin_time}`,
    row.tour_time && `Tour ${row.tour_time}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasNotes = row.notes_count + row.wa_count > 0 || !!row.guest_notes;
  return (
    <>
      <Facts>
        <Fact label="Guest reply" tone={s.tone}>
          {s.label}
        </Fact>
        <Fact label="Ticket">{productLabel(row.tour_type) || "—"}</Fact>
        <Fact label="Cfm #" tone={row.confirmation_no ? "plain" : "muted"}>
          {row.confirmation_no || "—"}
        </Fact>
        <Fact label="Time">{time || "—"}</Fact>
        <Fact label="SMS" tone={deliveryTone(sms.tone)}>
          {sms.label}
        </Fact>
        <Fact label="Email" tone={deliveryTone(email.tone)}>
          {email.label}
        </Fact>
        <Fact label="Submitted" tone={row.submitted_at ? "plain" : "muted"}>
          {formatSubmitted(row.submitted_at)}
          {row.resubmitted ? " (resubmitted)" : ""}
        </Fact>
        {/* 门票页口径：有对话的单，没人 Take action 就算没处理（同 tickets-tracking notesHeaderCount）。 */}
        <MessagesFact
          noteCount={row.notes_count + row.wa_count}
          needsAction={hasNotes && !row.action_taken_by}
          handledBy={row.action_taken_by}
        />
        {/* 后端还没给（「需要后端」）：给了才显示，口径同门票短信里的地点。 */}
        {row.checkin_location ? (
          <Fact label="Check-in location" wide>
            {row.checkin_location}
          </Fact>
        ) : null}
      </Facts>
      <LatestMessage row={row} guestNote={row.guest_notes} />
    </>
  );
}

// ── Morning Pickup ──

function MorningStatus({ row }: { row: MorningTrackingRow }) {
  const sms = smsStatusOf(row.sms_status);
  const email = emailStatusOf(row.email_state);
  const checkedIn = row.checkin_status === "checked_in";
  return (
    <>
      <Facts>
        <Fact label="Check-in" tone={checkedIn ? "good" : "warn"}>
          {checkedIn
            ? `Checked in ${formatCheckinTime(row.checkin_time)}`
            : "Not checked in"}
        </Fact>
        <Fact label="Pickup">
          {[row.pickup_time, row.pickup_location].filter(Boolean).join(" · ") ||
            "—"}
        </Fact>
        <Fact label="Driver / bus">
          {[row.driver, row.vehicle_no && `Bus ${row.vehicle_no}`]
            .filter(Boolean)
            .join(" · ") || "—"}
        </Fact>
        <Fact label="SMS" tone={deliveryTone(sms.tone)}>
          {sms.label}
        </Fact>
        <Fact label="Email" tone={deliveryTone(email.tone)}>
          {email.label}
        </Fact>
        <Fact
          label="Bus link viewed"
          tone={row.guest_viewed_at ? "plain" : "muted"}
        >
          {formatGuestViewed(row.guest_viewed_at)}
        </Fact>
        <MessagesFact
          noteCount={row.notes_count + row.wa_count}
          needsAction={row.notes_unhandled || row.wa_unhandled}
          handledBy={row.action_taken_by}
        />
      </Facts>
      <LatestMessage row={row} guestNote="" />
    </>
  );
}

// ── 对话 ──

function MessagesFact({
  noteCount,
  needsAction,
  handledBy,
}: {
  noteCount: number;
  needsAction: boolean;
  handledBy: string;
}) {
  if (needsAction) {
    return (
      <Fact label="Messages" tone="warn">
        ⚠️ Needs action{noteCount ? ` · ${noteCount}` : ""}
      </Fact>
    );
  }
  if (!noteCount)
    return (
      <Fact label="Messages" tone="muted">
        None
      </Fact>
    );
  return (
    <Fact label="Messages">
      {noteCount}
      {handledBy ? ` · handled by ${handledBy}` : ""}
    </Fact>
  );
}

type ConversationRow = Pick<
  TourTrackingRow,
  | "notes_count"
  | "latest_note_author"
  | "latest_note_body"
  | "latest_note_direction"
  | "wa_count"
  | "latest_wa_author"
  | "latest_wa_body"
  | "latest_wa_direction"
  | "wa_is_newer"
>;

/** 最新一条对话（WhatsApp 比 Notes 新就用 WhatsApp；谁说的判据同 components/ui/conversation-preview）；没有对话时写客人在确认页的留言。 */
function LatestMessage({
  row,
  guestNote,
}: {
  row: ConversationRow;
  guestNote: string;
}) {
  const useWa = row.wa_count > 0 && (row.wa_is_newer || !row.notes_count);
  const latest = useWa
    ? {
        author: row.latest_wa_author,
        body: row.latest_wa_body,
        direction: row.latest_wa_direction,
        via: "WhatsApp",
      }
    : row.notes_count
      ? {
          author: row.latest_note_author,
          body: row.latest_note_body,
          direction: row.latest_note_direction,
          via: "",
        }
      : null;
  const text = latest?.body || guestNote;
  if (!text) return null;
  const who = latest
    ? isInbound(latest.direction)
      ? "Guest"
      : latest.author || "Staff"
    : "Guest (confirmation page)";
  return (
    <p
      className="mt-2.5 line-clamp-2 rounded-[8px] bg-white/[.04] px-3 py-2 text-[12.5px] text-white/75"
      data-latest-message
    >
      <span className="font-semibold text-white/55">
        {who}
        {latest?.via ? ` · ${latest.via}` : ""}:
      </span>{" "}
      {text}
    </p>
  );
}
