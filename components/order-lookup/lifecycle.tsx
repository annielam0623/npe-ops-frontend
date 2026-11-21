"use client";

import { type ReactNode, useEffect, useState } from "react";

import { PageLink } from "@/components/ui/page-link";
import { usePhoneCollapse } from "@/components/ui/phone";
import {
  allChanges,
  bookedAt,
  type ChangeEntry,
  CHANGES_SHOWN,
  fetchOrderSends,
  LIFECYCLE_FRAME,
  sentFor,
  liveFor,
  LUNCH_NOT_IN_BUS,
  lunchPick,
  meaningfulChanges,
  receivedAt,
  replyFor,
  type SendModule,
  sentSub,
  tourEndedFor,
  vanAtHotel,
} from "@/lib/order-lifecycle";
import { orderDateToYmd } from "@/lib/order-lookup-api";
import { usePageVisibility } from "@/lib/page-visibility";
import { cn } from "@/lib/utils";
import type { OrderDetail, SendLogRow } from "@/types";

/**
 * 订单生命周期（Annie 2026-11-18「排法A」「框 1，其余照推荐，动手」）。
 * 开关 order_lifecycle（题 5 A，默认只 Super Admin）：看不到的人页面跟现在一模一样（没有新格子、没有蓝框、不多发请求）。
 */
export function useOrderLifecycle(orderNumber: string): {
  on: boolean;
  /** null = 还在拉；"error" = 拉不到（格子写「—」，不挡别的）。 */
  sends: SendLogRow[] | null | "error";
} {
  const vis = usePageVisibility();
  const on = vis.loaded && vis.visible("order_lifecycle");
  const [sends, setSends] = useState<{
    key: string;
    rows: SendLogRow[] | "error";
  } | null>(null);
  useEffect(() => {
    if (!on || !orderNumber) return;
    const ac = new AbortController();
    fetchOrderSends(orderNumber, ac.signal)
      .then((rows) => setSends({ key: orderNumber, rows }))
      .catch(() => {
        // 401 由页面别的请求跳登录；这里只当拉不到（格子写「—」）。
        if (ac.signal.aborted) return;
        setSends({ key: orderNumber, rows: "error" });
      });
    return () => ac.abort();
  }, [on, orderNumber]);
  return {
    on,
    sends: sends && sends.key === orderNumber ? sends.rows : null,
  };
}

export function sendsOf(sends: SendLogRow[] | null | "error"): SendLogRow[] {
  return Array.isArray(sends) ? sends : [];
}

// ── 订单详情页：Activity 卡上面的一块（题 1 A，同样的格子，浅色卡片）──────────

const SEND_ROWS: { module: SendModule; label: string }[] = [
  { module: "tour_confirmation", label: "Confirmation sent" },
  { module: "last_minute", label: "Last Minute" },
  { module: "tickets_reminder", label: "Ticket reminder sent" },
  { module: "morning_pickup", label: "Pickup reminder sent" },
];

function DField({
  label,
  tone,
  sub,
  children,
}: {
  label: string;
  tone?: "good" | "bad" | "warn" | "muted";
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0" data-lifecycle-field={label}>
      <dt className="text-[10.5px] font-semibold tracking-[.05em] text-[#5b6470] uppercase night:text-white/40">
        {label}
      </dt>
      <dd
        className={cn(
          "text-[12.5px] [overflow-wrap:anywhere] text-[#1a1a1a] night:text-white/85",
          tone === "good" && "font-semibold text-[#15803d]",
          tone === "bad" && "font-semibold text-[#b91c1c]",
          tone === "warn" && "font-semibold text-[#b45309]",
          tone === "muted" && "text-[#6b7280] night:text-white/45",
        )}
      >
        {children}
        {sub ? (
          <span className="block text-[11px] font-normal text-[#6b7280] night:text-white/45">
            {sub}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function replyTone(status: string): "good" | "bad" | "warn" | "muted" {
  return status === "yes"
    ? "good"
    : status === "cancel"
      ? "bad"
      : status === "pending"
        ? "muted"
        : "warn";
}

export function LifecycleCard({ order }: { order: OrderDetail }) {
  const { on, sends } = useOrderLifecycle(order.order_number);
  const [all, setAll] = useState(false);
  if (!on) return null;
  const date = orderDateToYmd(order.product.tour_date);
  const rows = sendsOf(sends);
  const changes = meaningfulChanges(order);
  const everything = allChanges(order);
  const reply = replyFor(order, date);
  const ticketReply = replyFor(order, date, "tickets_reminder");
  const pick = lunchPick(order, date);
  const live = liveFor(order, date);
  const van = live ? vanAtHotel(live.arrived_at, live.left_at) : null;
  const ended = tourEndedFor(order);
  return (
    <section
      aria-label="Order lifecycle"
      data-lifecycle-card
      className={cn(
        "rounded-[10px] border bg-paper px-4 py-3.5 night:bg-white/[.04]",
        LIFECYCLE_FRAME,
      )}
    >
      <h3 className="mb-2.5 text-[11px] font-semibold tracking-[0.6px] text-[#1d4ed8] uppercase night:text-[#93c5fd]">
        Order lifecycle
      </h3>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-5 gap-y-2 max-sm:grid-cols-2">
        <DField label="Booked" sub={bookedAt(order) ? "In Rezdy" : undefined}>
          {bookedAt(order) ?? "—"}
        </DField>
        <DField
          label="Received"
          sub={receivedAt(order) ? "In Order List" : undefined}
        >
          {receivedAt(order) ?? "—"}
        </DField>
        <DField label="Changes" tone={changes.length ? "warn" : "muted"}>
          {changes.length ? String(changes.length) : "None"}
        </DField>
        {SEND_ROWS.map(({ module, label }) => {
          const s = sentFor(order, rows, module, date);
          return (
            <DField
              key={module}
              label={label}
              tone={s ? undefined : "muted"}
              sub={s ? sentSub(s) || undefined : undefined}
            >
              {s ? s.at : sends === null ? "…" : "Not sent"}
            </DField>
          );
        })}
        {/* Annie (a) A：后端按单接口到了再补——bf 合同草稿 confirmations / lunch_by_day / live_by_day；旧后端没有 ⇒「—」。 */}
        <DField
          label="Guest reply"
          tone={reply ? replyTone(reply.status) : "muted"}
          sub={reply?.submitted ?? undefined}
        >
          {reply ? reply.label : "—"}
        </DField>
        {/* 门票的答复（bf 第 2 项：confirmations 带 tickets_reminder 行）：有才出。 */}
        {ticketReply ? (
          <DField
            label="Ticket reply"
            tone={replyTone(ticketReply.status)}
            sub={ticketReply.submitted ?? undefined}
          >
            {ticketReply.label}
          </DField>
        ) : null}
        {/* 第 4 件（Annie 2026-11-19「全部动手」，B1 A）：客人选的 + Bus Manifest 的两格并排，Restaurant 进 Bus 那格灰字。 */}
        <DField
          label="Guest's lunch pick"
          tone={pick.guest ? undefined : "muted"}
          sub={
            pick.guest?.at || pick.mismatch ? (
              <>
                {pick.guest?.at}
                {pick.mismatch ? (
                  <span
                    data-lunch-mismatch
                    className="block font-semibold text-[#c2410c] night:text-[#fb923c]"
                  >
                    {LUNCH_NOT_IN_BUS}
                  </span>
                ) : null}
              </>
            ) : undefined
          }
        >
          {pick.guest?.text ?? "—"}
        </DField>
        <DField
          label="Bus manifest lunch"
          tone={pick.bus?.has_lunch ? undefined : "muted"}
          sub={
            pick.bus?.restaurant
              ? `Restaurant: ${pick.bus.restaurant}`
              : undefined
          }
        >
          {pick.bus?.text ?? "—"}
        </DField>
        <DField label="Van at hotel" tone={van ? undefined : "muted"}>
          {van ?? "—"}
        </DField>
        {/* Relay / Bus 不在这里写（Annie 2026-11-18「全部同意推荐」）：订单详情页已有「Day of tour」卡，同一份 day_of_tour。 */}
        {/* ⑦ G360：回程第一个 Las Vegas 下客站 + 最后一站；没有 / 旧后端 ⇒「—」。 */}
        <DField label="Tour ended" tone={ended ? undefined : "muted"}>
          {ended ?? "—"}
        </DField>
      </dl>
      {changes.length || everything.length ? (
        <DetailChanges
          shown={all ? everything : changes.slice(0, CHANGES_SHOWN)}
          total={everything.length}
          canMore={
            !all && everything.length > Math.min(changes.length, CHANGES_SHOWN)
          }
          // Annie「但凡可以展开的页面一定要能折叠」：展开后 Show less，回到最近 3 条。
          canLess={
            all && everything.length > Math.min(changes.length, CHANGES_SHOWN)
          }
          onAll={() => setAll(true)}
          onLess={() => setAll(false)}
        />
      ) : null}
    </section>
  );
}

function DetailChanges({
  shown,
  total,
  canMore,
  canLess,
  onAll,
  onLess,
}: {
  shown: ChangeEntry[];
  total: number;
  canMore: boolean;
  canLess: boolean;
  onAll: () => void;
  onLess: () => void;
}) {
  const collapse = usePhoneCollapse();
  return (
    <div
      className="mt-3 border-t-[0.5px] border-black/10 pt-2.5 night:border-white/10"
      data-lifecycle-changes
    >
      <button
        type="button"
        onClick={collapse.toggle}
        className="flex w-full items-center gap-2 text-left text-[11px] font-semibold tracking-[0.6px] text-[#1d4ed8] uppercase night:text-[#93c5fd]"
      >
        Changes
        {collapse.caret}
      </button>
      <div className={collapse.hide}>
        {shown.length ? (
          <ul className="mt-1.5 grid gap-1.5">
            {shown.map((c) => (
              <ChangeLine key={c.id} c={c} light />
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[12px] text-[#6b7280]">No changes.</p>
        )}
        {canMore ? (
          <button
            type="button"
            data-changes-all
            onClick={onAll}
            className="mt-1.5 cursor-pointer text-[12px] font-semibold text-[#2563eb] night:text-white/60"
          >
            Show all {total} ▾
          </button>
        ) : canLess ? (
          <button
            type="button"
            data-changes-less
            onClick={onLess}
            className="mt-1.5 cursor-pointer text-[12px] font-semibold text-[#2563eb] night:text-white/60"
          >
            Show less ▴
          </button>
        ) : null}
      </div>
    </div>
  );
}

const SOURCE_CLASS = {
  rezdy: "text-[#60a5fa]",
  staff: "text-[#a78bfa]",
  guest: "text-[#4ade80]",
  system: "text-white/45",
} as const;
const SOURCE_CLASS_LIGHT = {
  rezdy: "text-[#1d4ed8]",
  staff: "text-[#6d28d9]",
  guest: "text-[#15803d]",
  system: "text-[#6b7280]",
} as const;

/** 一条改动：时间 · 来源 · 旧值划线 → 新值（没有前后值就写那句话）。 */
/** 「Tour date, Phone, Email」；多于 3 个写前两个 +N（照 4d 转的例子「Tour date, Phone +2 more」）。「Tour date (PBZ)」去掉产品码，同名只写一次。 */
function changedSummary(fields: string[]): string {
  const names = [
    ...new Set(
      fields.map((f) =>
        f
          .replace(/\s*#\d+\s*$/, "")
          .replace(/\s*\([^)]*\)\s*$/, "")
          .trim(),
      ),
    ),
  ];
  return names.length > 3
    ? `${names.slice(0, 2).join(", ")} +${names.length - 2} more`
    : names.join(", ");
}

export function ChangeLine({
  c,
  light = false,
}: {
  c: ChangeEntry;
  light?: boolean;
}) {
  // Annie「rezdy的内容也需要可以展开和收起」：rezdy_changes 那几条默认收成一行「Changed: 字段名 ▸」，点开看旧 → 新，再点 ▴ 收回。
  const [open, setOpen] = useState(false);
  const foldable = !!c.fromRezdy && c.items.length > 0;
  const diffs = c.items.map((it, i) =>
    it.changedOnly ? (
      // G351：只知道改了、没有前后值（partner 看到的 Internal notes (Rezdy)），照后端原文一行。
      <span key={i} className="block" data-change-only>
        {it.field}: changed
      </span>
    ) : (
      <span key={i} className="block">
        {it.field}{" "}
        <span
          data-change-old
          className={cn(
            "line-through",
            light ? "text-[#6b7280]" : "text-white/45",
          )}
        >
          {it.before === null ? "—" : it.before || "(empty)"}
        </span>{" "}
        → {it.after === null ? "—" : it.after || "(empty)"}
      </span>
    ),
  );
  return (
    <li
      data-change={c.source}
      data-change-open={foldable ? (open ? "" : undefined) : undefined}
      className={cn(
        "grid grid-cols-[minmax(0,150px)_minmax(0,90px)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px] max-sm:grid-cols-1",
        light ? "text-[#1a1a1a] night:text-white/85" : "text-white/85",
      )}
    >
      <span
        className={cn(
          "tabular-nums",
          light ? "text-[#6b7280] night:text-white/40" : "text-white/40",
        )}
      >
        {c.at}
      </span>
      <span
        className={cn(
          "font-semibold",
          (light ? SOURCE_CLASS_LIGHT : SOURCE_CLASS)[c.source],
        )}
      >
        {c.who}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {foldable ? (
          <>
            <button
              type="button"
              data-change-toggle
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "cursor-pointer text-left",
                light ? "text-[#1a1a1a] night:text-white/85" : "text-white/85",
              )}
            >
              Changed: {changedSummary(c.items.map((it) => it.field))}{" "}
              {open ? "▴" : "▸"}
            </button>
            {open ? <span className="mt-0.5 block">{diffs}</span> : null}
          </>
        ) : c.items.length ? (
          diffs
        ) : (
          c.text
        )}
      </span>
    </li>
  );
}

// ── Chat history（Annie 2026-11-18「全部同意推荐。动手」，样稿第 8 版 C1–C4 全 A）──────────────

/** 订单详情接口的 booking_notes 一条（ASC）。 */
type Note = OrderDetail["booking_notes"][number];

const CHAT_SHOWN = 3;

/** 「Guest · SMS」「kevin · Email」「Guest · Voice message」。 */
export function chatWho(n: Note): { who: string; guest: boolean } {
  switch (n.direction) {
    case "sms_in":
      return {
        who: n.channel === "whatsapp" ? "Guest · WhatsApp" : "Guest · SMS",
        guest: true,
      };
    case "email_in":
      return { who: "Guest · Email", guest: true };
    case "guest_reply":
      return { who: "Guest · Web", guest: true };
    case "voice_in":
      return { who: "Guest · Voice message", guest: true };
    case "sms_out":
      return {
        who: `${n.author || "Staff"} · ${n.channel === "whatsapp" ? "WhatsApp" : "SMS"}`,
        guest: false,
      };
    case "email_out":
      return { who: `${n.author || "Staff"} · Email`, guest: false };
    default:
      return { who: `${n.author || "Staff"} · Note`, guest: false };
  }
}

/**
 * 搜索结果最下面的「Chat history」块（三个 Tracking 块下面、How to use 上面）：新 → 旧，默认 3 条，Show all ⇄ Show less；
 * 手机上默认收起。只给看得到生命周期、又有 messages.view 的人（调用方判断）。
 */
export function ChatHistoryBlock({
  notes,
  frame,
}: {
  notes: readonly Note[];
  frame: string;
}) {
  const [all, setAll] = useState(false);
  const collapse = usePhoneCollapse();
  const newest = [...notes].reverse();
  const shown = all ? newest : newest.slice(0, CHAT_SHOWN);
  const more = newest.length > CHAT_SHOWN;
  return (
    <div
      className={cn("rounded-[12px] border bg-white/[.025] px-4 py-3", frame)}
      data-lookup-block="chat"
    >
      <div className="flex items-baseline gap-3">
        <button
          type="button"
          onClick={collapse.toggle}
          className="text-left text-[13.5px] font-semibold"
        >
          Chat history
        </button>
        {more ? (
          <button
            type="button"
            data-chat-toggle
            onClick={() => {
              setAll((v) => !v);
              collapse.setOpen(true);
            }}
            className="ml-auto cursor-pointer text-[12.5px] font-semibold text-white/60 hover:text-white"
          >
            {all ? "Show less ▴" : `Show all ${newest.length} ▾`}
          </button>
        ) : (
          <span className="ml-auto" />
        )}
        {collapse.caret}
      </div>
      <div className={collapse.hide}>
        {shown.length ? (
          <ul className="mt-2 grid gap-1.5">
            {shown.map((n) => {
              const { who, guest } = chatWho(n);
              return (
                <li
                  key={n.id}
                  data-chat={n.direction}
                  className="grid grid-cols-[minmax(0,150px)_minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px] text-white/85 max-sm:grid-cols-1"
                >
                  <span className="text-white/40 tabular-nums">
                    {n.created_at}
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      guest ? "text-[#4ade80]" : "text-[#a78bfa]",
                    )}
                  >
                    {who}
                  </span>
                  <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">
                    {n.body}
                    {n.direction === "voice_in" ? (
                      <span className="text-white/45"> (transcript)</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[12.5px] text-white/45" data-chat-empty>
            No messages yet.
          </p>
        )}
      </div>
    </div>
  );
}

const CHAT_PATH = {
  tour_confirmation: { path: "/tour-confirmation/tracking", label: "Tour" },
  tickets_reminder: { path: "/tickets-reminder/tracking", label: "Tickets" },
  morning_pickup: { path: "/morning-pickup/tracking", label: "Morning" },
} as const;
type ChatModule = keyof typeof CHAT_PATH;

/** 这单这天有哪些 Tracking 线（confirmations 有就照它；旧后端按订单类型猜：门票 ⇒ Tickets，其余 ⇒ Tour）。 */
function chatLines(order: OrderDetail, date: string | null): ChatModule[] {
  if (!date) return [];
  const mods = [
    ...new Set(
      (order.confirmations ?? [])
        .filter((c) => c.tour_date === date && c.module in CHAT_PATH)
        .map((c) => c.module as ChatModule),
    ),
  ];
  if (mods.length) return mods;
  return [
    order.booking_type === "ticket" ? "tickets_reminder" : "tour_confirmation",
  ];
}

/**
 * 订单详情页最下面的「Chat history」（C3 A：原 Notes 卡里的对话挪到这里、改名，写法同搜索结果），
 * 右上「Open chat →」（几条线各一个：Open chat · Tour → / · Morning →）。调用方判断开关 + messages.view。
 */
export function OrderChatHistory({
  order,
  guestOnly = false,
}: {
  order: OrderDetail;
  /** ★ Note 打通（Q5 B）：订单页有「★ Notes」卡时，这里只放客人对话。 */
  guestOnly?: boolean;
}) {
  const [all, setAll] = useState(false);
  const collapse = usePhoneCollapse();
  const date = orderDateToYmd(order.product.tour_date);
  const newest = [...(order.booking_notes ?? [])]
    .filter((n) => !guestOnly || n.direction !== "staff_note")
    .reverse();
  const shown = all ? newest : newest.slice(0, CHAT_SHOWN);
  const lines = chatLines(order, date);
  const on = encodeURIComponent(order.order_number);
  return (
    <section
      aria-label="Chat history"
      data-order-chat
      className={cn(
        "mt-3 rounded-[10px] border bg-paper px-4 py-3.5 night:bg-white/[.04]",
        LIFECYCLE_FRAME,
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={collapse.toggle}
          className="text-left text-[11px] font-semibold tracking-[0.6px] text-[#1d4ed8] uppercase night:text-[#93c5fd]"
        >
          Chat history
        </button>
        {collapse.caret}
        <span className="ml-auto flex flex-wrap gap-3">
          {date
            ? lines.map((m) => (
                <PageLink
                  key={m}
                  data-open-chat={m}
                  href={`${CHAT_PATH[m].path}?date=${date}&q=${on}&chat=${on}`}
                  className="text-[12px] font-semibold text-[#2563eb] night:text-white/60"
                >
                  {lines.length > 1
                    ? `Open chat · ${CHAT_PATH[m].label} →`
                    : "Open chat →"}
                </PageLink>
              ))
            : null}
          {newest.length > CHAT_SHOWN ? (
            <button
              type="button"
              data-chat-toggle
              onClick={() => {
                setAll((v) => !v);
                collapse.setOpen(true);
              }}
              className="cursor-pointer text-[12px] font-semibold text-[#2563eb] night:text-white/60"
            >
              {all ? "Show less ▴" : `Show all ${newest.length} ▾`}
            </button>
          ) : null}
        </span>
      </div>
      <div className={collapse.hide}>
        {shown.length ? (
          <ul className="grid gap-1.5">
            {shown.map((n) => {
              const { who, guest } = chatWho(n);
              return (
                <li
                  key={n.id}
                  data-chat={n.direction}
                  className="grid grid-cols-[minmax(0,150px)_minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px] text-[#1a1a1a] max-sm:grid-cols-1 night:text-white/85"
                >
                  <span className="text-[#6b7280] tabular-nums night:text-white/40">
                    {n.created_at}
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      guest ? "text-[#15803d]" : "text-[#6d28d9]",
                    )}
                  >
                    {who}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {n.body}
                    {n.direction === "voice_in" ? (
                      <span className="text-[#6b7280]"> (transcript)</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-[#6b7280]" data-chat-empty>
            No messages yet.
          </p>
        )}
      </div>
    </section>
  );
}
