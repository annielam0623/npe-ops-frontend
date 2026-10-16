"use client";

import { type DragEvent, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { SeatingBus, SeatingOrder, SeatingTour } from "@/types";

/**
 * Seat guests（G29 第 4 条）——Annie 2026-10-11 定：不单设 Step 3，每台车装了哪些订单放在 Step 2 **那台车的下面**，
 * 默认收起，只写「N orders · N guests」，点开看名单；名单里仍可拖动 / 下拉换车（同旧页面 `_seat_guests_panel.html`）。
 * 数据是 `GET /api/dispatch/seating`：车 = Step 2 已保存的车（manifest_id + bus_label 对上），客人只来自 Step 1 上传的名单。
 * 挪车 `POST /api/dispatch/seating/move`：选字母 = staff 定的（重传 / 改排车时自动分车不动它）；Auto = 交回自动分车。
 *
 * 点了 Completed 的日子（后端 G56，Annie 2026-10-12）：后端不再自动分车、已坐好的不动，新单留在 Not on a bus，由 staff 选车。
 * 所以那天下拉里**不给 Auto**（选了也没人分），每台车写「已坐 / 座位」，不预选、不推荐（Annie：系统不判断）；
 * Completed 之后新进来的单标「New after Completed」。
 */

/** 这一天点没点过 Completed、Completed 之后新进来的单号（排车页从 Step 1 拿到后传下来）。 */
export interface SeatDayState {
  completed: boolean;
  newOrders: ReadonlySet<string>;
}

const OPEN_DAY: SeatDayState = { completed: false, newOrders: new Set() };

const SEAT_DRAG = "application/x-npe-seat";

export interface SeatMove {
  order: SeatingOrder;
  /** null = Auto。 */
  to: string | null;
}

function sum(orders: SeatingOrder[]) {
  return orders.reduce((n, o) => n + o.pax, 0);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** 一张订单：名字、单号、几位、接客时间地点；下拉换车；可拖到同一团的另一台车。 */
function OrderLine({
  tour,
  order,
  disabled,
  onMove,
  day,
}: {
  tour: SeatingTour;
  order: SeatingOrder;
  disabled: boolean;
  onMove: (m: SeatMove) => void;
  day: SeatDayState;
}) {
  const buses = tour.buses.filter(
    (b): b is SeatingBus & { label: string } => !!b.label,
  );
  const isNew = !!order.order_number && day.newOrders.has(order.order_number);
  const where = [order.pickup_time, order.pickup_location]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      data-seat-order={order.order_number ?? order.guest_ids.join("-")}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(
          SEAT_DRAG,
          JSON.stringify({
            m: tour.manifest_id,
            ids: order.guest_ids,
            from: order.bus_label,
          }),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-lg border-[0.5px] border-black/15 bg-paper px-2.5 py-1.5 text-[12.5px]",
        !disabled && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="truncate font-semibold">
        {order.name || "—"}
        {order.order_number ? (
          <span className="ml-1.5 font-normal text-[#1a1a1a]">
            {order.order_number}
          </span>
        ) : null}
      </span>
      <span className="font-bold tabular-nums">{order.pax}</span>
      <span className="truncate text-[11.5px] text-[#1a1a1a]">{where}</span>
      {day.completed ? (
        <select
          aria-label={`Bus for ${order.name || order.order_number || "this order"}`}
          disabled={disabled}
          value={order.bus_label ?? ""}
          onChange={(e) => {
            if (e.target.value) onMove({ order, to: e.target.value });
          }}
          className="h-6 rounded-md border-[0.5px] border-black/25 bg-paper px-1 text-[11.5px] disabled:opacity-60"
        >
          {order.bus_label ? null : (
            <option value="" disabled>
              Choose a bus…
            </option>
          )}
          {buses.map((b) => (
            <option key={b.label} value={b.label}>
              Bus {b.label} ({b.pax} / {b.capacity})
            </option>
          ))}
        </select>
      ) : (
        <select
          aria-label={`Bus for ${order.name || order.order_number || "this order"}`}
          disabled={disabled}
          value={order.staff ? (order.bus_label ?? "") : ""}
          onChange={(e) =>
            onMove({ order, to: e.target.value ? e.target.value : null })
          }
          className="h-6 rounded-md border-[0.5px] border-black/25 bg-paper px-1 text-[11.5px] disabled:opacity-60"
        >
          <option value="">Auto</option>
          {buses.map((b) => (
            <option key={b.label} value={b.label}>
              Bus {b.label}
            </option>
          ))}
        </select>
      )}
      {isNew ? (
        <span className="col-span-2">
          <span className="inline-block rounded-[5px] bg-[#e6f4ec] px-1.5 py-[1px] text-[11px] font-semibold text-[#1e6b43]">
            New after Completed
          </span>
        </span>
      ) : null}
      {order.staff && !day.completed ? (
        <span className="col-span-2 text-[11px] text-[#1d4ed8]">
          Placed by staff — Auto hands it back to automatic seating.
        </span>
      ) : null}
    </li>
  );
}

function readDrag(
  e: DragEvent,
): { m: number; ids: number[]; from: string | null } | null {
  try {
    const raw = e.dataTransfer.getData(SEAT_DRAG);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 一台车下面：收起时一行「N orders · N guests」+ 坐了几 / 几座；点开列订单。整块可以接住同一团拖来的订单。 */
export function BusGuests({
  tour,
  bus,
  disabled,
  onMove,
  openSignal,
  day = OPEN_DAY,
}: {
  tour: SeatingTour;
  bus: SeatingBus;
  disabled: boolean;
  onMove: (m: SeatMove) => void;
  /** 变了（>0）就展开：Step 1 卡片的 Seat guests 跳过来时。 */
  openSignal?: number;
  day?: SeatDayState;
}) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const orders = tour.orders.filter((o) => o.bus_label === bus.label);
  const full = bus.pax > bus.capacity;
  return (
    <div
      data-bus-guests={`${tour.manifest_id}:${bus.label ?? ""}`}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes(SEAT_DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const d = readDrag(e);
        if (!d || d.m !== tour.manifest_id || d.from === bus.label) return;
        e.preventDefault();
        const order = tour.orders.find(
          (o) => o.guest_ids.join() === d.ids.join(),
        );
        if (order) onMove({ order, to: bus.label });
      }}
      className={cn(
        "mt-1.5 rounded-[10px] border border-[#dfe3e8] bg-paper",
        over && "border-[#3b82f6] shadow-[0_0_0_2px_rgba(59,130,246,.25)]",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-[7px] text-left text-[12.5px] text-[#1a1a1a]"
      >
        <span
          aria-hidden
          className={cn(
            "text-[10px] transition-transform",
            open && "rotate-90",
          )}
        >
          ▸
        </span>
        <span className="font-semibold">
          {plural(orders.length, "order")} · {plural(bus.pax, "guest")}
        </span>
        <span
          className={cn(
            "ml-auto font-[650] tabular-nums",
            full ? "text-[#b3261e]" : "text-[#1e6b43]",
          )}
        >
          {bus.pax} / {bus.capacity} seats
        </span>
      </button>
      {open ? (
        orders.length ? (
          <ul className="flex flex-col gap-1.5 px-2 pb-2">
            {orders.map((o) => (
              <OrderLine
                key={o.guest_ids.join("-")}
                tour={tour}
                order={o}
                disabled={disabled}
                onMove={onMove}
                day={day}
              />
            ))}
          </ul>
        ) : (
          <p className="m-0 px-3 pb-2 text-[12px] text-[#1a1a1a]">
            No guests on this bus. Drag an order here.
          </p>
        )
      ) : null}
    </div>
  );
}

/** 只有一台车：大家都坐它，不列订单（同旧页面 single）。 */
export function SingleBusGuests({ tour }: { tour: SeatingTour }) {
  return (
    <p
      data-bus-guests={`${tour.manifest_id}:single`}
      className="mt-1.5 mb-0 rounded-[10px] border border-[#dfe3e8] bg-paper px-3 py-[7px] text-[12.5px] text-[#1a1a1a]"
    >
      One bus: all {plural(tour.pax, "guest")} ride this bus.
    </p>
  );
}

/**
 * 一个团的车下面最后：没坐上车的订单（橙色，同旧页面 Not on a bus；装不下的以后由 staff 挪到 Farm out 车，
 * 见 docs/farm-out/任务包_farm-out.md）、名单还没传 / 字母没填好的说明、挪车出错的原因。
 */
export function TourSeatingNotes({
  tour,
  dirty,
  error,
  disabled,
  onMove,
  openSignal,
  day = OPEN_DAY,
}: {
  tour: SeatingTour | undefined;
  dirty: boolean;
  error: string | null;
  disabled: boolean;
  onMove: (m: SeatMove) => void;
  openSignal?: number;
  day?: SeatDayState;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const unplaced =
    tour?.mode === "lettered"
      ? tour.orders.filter((o) => o.bus_label === null)
      : [];
  const notes: string[] = [];
  if (tour && !tour.uploaded)
    notes.push(
      "No guest list for this tour yet: the main manifest has no orders for it on this day.",
    );
  else if (tour?.mode === "unlettered")
    notes.push(
      "Give each bus a different letter to seat guests.",
    );
  if (dirty && tour?.uploaded)
    notes.push(
      "Guests are seated on the saved schedule; they update once your changes are saved.",
    );
  if (!unplaced.length && !notes.length && !error) return null;
  return (
    <div
      className="mt-2 flex flex-col gap-1.5"
      data-seat-notes={tour?.manifest_id}
    >
      {error ? (
        <p role="alert" className="m-0 text-[12.5px] text-[#b3261e]">
          {error}
        </p>
      ) : null}
      {notes.map((n) => (
        <p key={n} className="m-0 text-[12.5px] text-[#1a1a1a]">
          {n}
        </p>
      ))}
      {unplaced.length && tour ? (
        <div
          data-unplaced={tour.manifest_id}
          className="rounded-[10px] border border-[#f3c98b] bg-[#fff6eb]"
        >
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-3 py-[7px] text-left text-[12.5px] text-[#8a5a00]"
          >
            <span
              aria-hidden
              className={cn(
                "text-[10px] transition-transform",
                open && "rotate-90",
              )}
            >
              ▸
            </span>
            <span className="font-semibold">
              Not on a bus: {plural(unplaced.length, "order")} ·{" "}
              {plural(sum(unplaced), "guest")}
            </span>
            <span className="ml-auto">
              {day.completed
                ? "Completed: pick a bus for each order"
                : "No room on today’s buses"}
            </span>
          </button>
          {open ? (
            <ul className="flex flex-col gap-1.5 px-2 pb-2">
              {unplaced.map((o) => (
                <OrderLine
                  key={o.guest_ids.join("-")}
                  tour={tour}
                  order={o}
                  disabled={disabled}
                  onMove={onMove}
                  day={day}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
