"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

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
  isSameOrder,
  type LaneResult,
  lookupOrder,
  type OrderLookup as LookupResult,
  searchOrders,
} from "@/lib/order-lookup-api";
import { cn } from "@/lib/utils";
import type {
  MorningTrackingRow,
  OrderRow,
  TicketsTrackingRow,
  TourTrackingRow,
} from "@/types";

/** 一次搜出来的几张单（按单号 / 姓名 / 电话）。 */
interface Matches {
  query: string;
  orders: OrderRow[];
  /** 最近 200 条以外还有。 */
  more: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "not-found"; query: string }
  | { kind: "error"; message: string }
  | { kind: "list"; matches: Matches }
  /** back：从搜出来的名单点进来的，可以回到名单。 */
  | { kind: "ready"; result: LookupResult; back?: Matches };

/** 深色底上的字色（整站外框是深色，tracking 页的浅底配色在这里看不清）。 */
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
 * 订单查询（Annie 2026-10-14）：输入单号、客人姓名或电话之一 → 只有一张单（或单号完全对上）直接打开：订单详情 + 这单在三个 Tracking 页上的现状；
 * 好几张单先列出来让 staff 点一张。只读；改状态、回消息都去对应的 Tracking 页（每块右上角的链接，带日期和单号）。输入框在整站顶栏（top-order-search.tsx）。
 */
export type LookupState = State;

export function useOrderLookup(onUnauthorized: () => void) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => () => controllerRef.current?.abort(), []);

  /** 起一次请求：前一次没回来的作废；401 跳登录，其余写原因。 */
  async function run(
    query: string,
    work: (signal: AbortSignal) => Promise<State>,
  ) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "loading", query });
    try {
      const next = await work(controller.signal);
      if (!controller.signal.aborted) setState(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isStatus(error, 401)) {
        onUnauthorizedRef.current();
        return;
      }
      setState({ kind: "error", message: describeError(error) });
    }
  }

  async function open(
    orderNumber: string,
    signal: AbortSignal,
    back?: Matches,
  ): Promise<State> {
    const result = await lookupOrder(orderNumber, signal);
    return result
      ? { kind: "ready", result, back }
      : { kind: "not-found", query: orderNumber };
  }

  function search(input: string) {
    const query = input.trim();
    if (!query) return;
    void run(query, async (signal) => {
      const { orders, more } = await searchOrders(query, signal);
      const exact = orders.find((o) => isSameOrder(o.order_number, query));
      if (exact) return open(exact.order_number, signal);
      if (orders.length === 1) return open(orders[0].order_number, signal);
      // 列表里没有的单号（极少）：照旧按单号直接查一次。
      if (orders.length === 0) return open(query, signal);
      return { kind: "list", matches: { query, orders, more } };
    });
  }

  /** 从名单里点一张。 */
  function pick(orderNumber: string, back: Matches) {
    void run(orderNumber, (signal) => open(orderNumber, signal, back));
  }

  function backTo(matches: Matches) {
    controllerRef.current?.abort();
    setState({ kind: "list", matches });
  }

  function clear() {
    controllerRef.current?.abort();
    setState({ kind: "idle" });
  }

  return { state, search, pick, backTo, clear };
}

export function LookupBody({
  state,
  onPick,
  onBack,
}: {
  state: State;
  onPick: (orderNumber: string, back: Matches) => void;
  onBack: (matches: Matches) => void;
}) {
  switch (state.kind) {
    case "idle":
      return null;
    case "loading":
      return <Note>Looking up {state.query}…</Note>;
    case "not-found":
      return (
        <Note tone="warn">
          No order matches “{state.query}”. Try the order # (Rezdy or CHD), the
          guest’s name or phone number.
        </Note>
      );
    case "error":
      return <Note tone="bad">Lookup failed: {state.message}</Note>;
    case "list":
      return <MatchList matches={state.matches} onPick={onPick} />;
    case "ready":
      return (
        <>
          {state.back ? (
            <button
              type="button"
              data-back-to-list
              onClick={() => onBack(state.back!)}
              className="mb-3 text-[12.5px] font-semibold text-white/65 hover:text-white"
            >
              ← Back to {state.back.orders.length} matches for “
              {state.back.query}”
            </button>
          ) : null}
          <LookupResultView result={state.result} />
        </>
      );
  }
}

/** 好几张单对得上：列出来，点一行打开那一张。新的在前（同 Orders 页的排序）。 */
function MatchList({
  matches,
  onPick,
}: {
  matches: Matches;
  onPick: (orderNumber: string, back: Matches) => void;
}) {
  const { query, orders, more } = matches;
  return (
    <div data-match-list>
      <p className="mb-2 text-[13px] text-white/70">
        {orders.length} orders match “{query}”. Click one to see it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-white/10 text-[11px] tracking-[.05em] text-white/45 uppercase">
              {[
                "Order #",
                "Guest",
                "Phone",
                "Product",
                "Tour date",
                "Status",
              ].map((h) => (
                <th key={h} className="px-2 py-1.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr
                key={o.order_number}
                data-match={o.order_number}
                tabIndex={0}
                onClick={() => onPick(o.order_number, matches)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onPick(o.order_number, matches);
                }}
                className="cursor-pointer border-b border-white/[.06] hover:bg-white/[.05] focus-visible:bg-white/[.05] focus-visible:outline-none"
              >
                <td className="px-2 py-2 font-semibold whitespace-nowrap">
                  {o.order_number}
                </td>
                <td className="px-2 py-2">{o.name}</td>
                <td className="px-2 py-2 whitespace-nowrap text-white/75">
                  {o.phone}
                </td>
                <td className="px-2 py-2 text-white/75">{o.product_name}</td>
                <td className="px-2 py-2 whitespace-nowrap text-white/75">
                  {o.tour_date}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 font-semibold whitespace-nowrap",
                    orderStatusTone(o.status),
                  )}
                >
                  {o.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more ? (
        <p className="mt-2 text-[12px] text-[#fbbf24]">
          Showing the most recent matches only. Type more of the name or number
          to narrow it down.
        </p>
      ) : null}
    </div>
  );
}

function Note({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <p className={cn("text-[13px]", TONE_CLASS[tone])} data-lookup-note>
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
    <div className="grid gap-3.5" data-lookup-result>
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
