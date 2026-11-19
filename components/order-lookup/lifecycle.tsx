"use client";

import { type ReactNode, useEffect, useState } from "react";

import { usePhoneCollapse } from "@/components/ui/phone";
import {
  allChanges,
  bookedAt,
  type ChangeEntry,
  CHANGES_SHOWN,
  dayOfTourFor,
  fetchOrderSends,
  LIFECYCLE_FRAME,
  latestSend,
  liveFor,
  lunchFor,
  markText,
  markTone,
  meaningfulChanges,
  receivedAt,
  replyFor,
  type SendModule,
  sentSub,
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

export function LifecycleCard({ order }: { order: OrderDetail }) {
  const { on, sends } = useOrderLifecycle(order.order_number);
  const [all, setAll] = useState(false);
  if (!on) return null;
  const date = orderDateToYmd(order.product.tour_date);
  const rows = sendsOf(sends);
  const changes = meaningfulChanges(order);
  const everything = allChanges(order);
  const day = dayOfTourFor(order, date);
  const relay = day?.relay_mark ?? null;
  const bus = day?.bus_mark ?? null;
  const reply = replyFor(order, date);
  const lunch = lunchFor(order, date);
  const live = liveFor(order, date);
  const van = live ? vanAtHotel(live.arrived_at, live.left_at) : null;
  return (
    <section
      aria-label="Order lifecycle"
      data-lifecycle-card
      className={cn(
        "rounded-[10px] border bg-paper px-4 py-3.5 night:bg-white/[.04]",
        LIFECYCLE_FRAME,
      )}
    >
      <h3 className="mb-2.5 text-[11px] font-semibold tracking-[0.6px] text-[#1a1a1a] uppercase night:text-white/35">
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
          const s = latestSend(rows, module, date);
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
          tone={
            !reply
              ? "muted"
              : reply.status === "yes"
                ? "good"
                : reply.status === "cancel"
                  ? "bad"
                  : reply.status === "pending"
                    ? "muted"
                    : "warn"
          }
          sub={reply?.submitted ?? undefined}
        >
          {reply ? reply.label : "—"}
        </DField>
        <DField label="Lunch" tone={lunch?.text ? undefined : "muted"}>
          {lunch?.text || "—"}
        </DField>
        <DField
          label="Restaurant"
          tone={lunch?.restaurant ? undefined : "muted"}
        >
          {lunch?.restaurant || "—"}
        </DField>
        <DField label="Van at hotel" tone={van ? undefined : "muted"}>
          {van ?? "—"}
        </DField>
        <DField
          label="Relay"
          tone={
            relay
              ? markTone(relay) === "plain"
                ? undefined
                : (markTone(relay) as "good" | "bad")
              : "muted"
          }
          sub={relay ? markText(relay).sub : undefined}
        >
          {relay ? markText(relay).main : "—"}
        </DField>
        <DField
          label="Bus"
          tone={
            bus
              ? markTone(bus) === "plain"
                ? undefined
                : (markTone(bus) as "good" | "bad")
              : "muted"
          }
          sub={bus ? markText(bus).sub : undefined}
        >
          {bus ? markText(bus).main : "—"}
        </DField>
        {/* 题 4 B：后端还没有回程到站，先写「—」。 */}
        <DField label="Tour ended" tone="muted">
          —
        </DField>
      </dl>
      {changes.length || everything.length ? (
        <DetailChanges
          shown={all ? everything : changes.slice(0, CHANGES_SHOWN)}
          total={everything.length}
          canMore={
            !all && everything.length > Math.min(changes.length, CHANGES_SHOWN)
          }
          onAll={() => setAll(true)}
        />
      ) : null}
    </section>
  );
}

function DetailChanges({
  shown,
  total,
  canMore,
  onAll,
}: {
  shown: ChangeEntry[];
  total: number;
  canMore: boolean;
  onAll: () => void;
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
        className="flex w-full items-center gap-2 text-left text-[11px] font-semibold tracking-[0.6px] text-[#1a1a1a] uppercase night:text-white/35"
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
export function ChangeLine({
  c,
  light = false,
}: {
  c: ChangeEntry;
  light?: boolean;
}) {
  return (
    <li
      data-change={c.source}
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
        {c.items.length
          ? c.items.map((it, i) => (
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
            ))
          : c.text}
      </span>
    </li>
  );
}
