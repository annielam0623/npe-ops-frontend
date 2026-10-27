"use client";

import type { CSSProperties, ReactNode } from "react";

import { tourColorFor } from "@/lib/tour-colors";
import { cn } from "@/lib/utils";
import type { DispatchPrivateOrder, DispatchRow } from "@/types";
import { useViewOnly } from "@/components/ui/view-only";

import { secOf, type Lookup } from "./config";
import { BusIcon } from "./icons";
import { ADDVAN, BANNER, TM_BTN } from "./legacy-styles";

/** 这些车坐得下几位："56 + 24 = 80 seats" / "14 seats" / 有车没填座位数是 null。 */
export function seatsSummary(seats: (number | null)[]): {
  text: string;
  total: number | null;
} {
  if (!seats.length) return { text: "no vehicle yet", total: 0 };
  if (seats.some((n) => n === null))
    return { text: "seats not set for a vehicle", total: null };
  const nums = seats as number[];
  const total = nums.reduce((a, b) => a + b, 0);
  return {
    text:
      nums.length > 1
        ? `${nums.join(" + ")} = ${total} seats`
        : `${total} seats`,
    total,
  };
}

/**
 * Private Tour 按 Rezdy 订单分卡（G82，Annie 2026-10-16 看过预览）：一张订单一张卡，
 * 上面是团名（订单的产品名）+ 订单号 / 客人 / 默认接客，下面是这张订单的车（一单几台车放在同一张卡里），
 * 再下面是 Notes（Rezdy 备注原文，默认接客时间 / 地点可能不准），最后 + Add vehicle。
 * 没有订单的车放在最后一张「Vehicles without an order」。座位不够的订单卡头红字 + 红条。
 */
export function PrivateOrderCards({
  sectionKey,
  orders,
  rows,
  L,
  disabled,
  renderVan,
  onAdd,
  onRematch,
  saveBar,
}: {
  sectionKey: string;
  orders: DispatchPrivateOrder[];
  rows: DispatchRow[];
  L: Lookup;
  disabled: boolean;
  renderVan: (rowIndex: number) => ReactNode;
  /** 加一台车：带订单号 = 加在这张订单下面（staff 指定）；不带 = 没订单的车。 */
  onAdd: (order?: string) => void;
  onRematch: () => void;
  /** 这一块（Private Tour 单元）的保存区，放在订单卡上面。 */
  saveBar?: ReactNode;
}) {
  const viewOnly = useViewOnly();
  const mine = rows.flatMap((r, i) => (secOf(r) === sectionKey ? [i] : []));
  const known = new Set(orders.map((o) => o.order_number));
  const forOrder = (o: DispatchPrivateOrder) =>
    mine.filter((i) => rows[i].order_number === o.order_number);
  const orphans = mine.filter((i) => {
    const n = rows[i].order_number;
    return !n || !known.has(n);
  });
  const noCar = orders.filter((o) => !forOrder(o).length);

  return (
    <div
      data-sec={sectionKey}
      data-private-orders
      className="flex flex-col gap-4"
    >
      {saveBar}
      {noCar.length || orphans.some((i) => !rows[i].order_number) ? (
        <div
          role="status"
          data-private-nocar
          className={cn(BANNER, "flex flex-wrap items-center gap-3")}
        >
          <span className="mr-auto">
            {noCar.length ? (
              <>
                <b>
                  {noCar.length}{" "}
                  {noCar.length === 1 ? "order has" : "orders have"} no vehicle
                  yet.
                </b>{" "}
              </>
            ) : null}
            {orphans.some((i) => !rows[i].order_number)
              ? "Some vehicles have no order. "
              : ""}
            {viewOnly ? "" : "Add a vehicle, then Re-match."}
          </span>
          <button
            type="button"
            hidden={viewOnly}
            disabled={disabled}
            onClick={onRematch}
            className={TM_BTN}
          >
            Re-match
          </button>
        </div>
      ) : null}

      {orders.map((o) => {
        const idxs = forOrder(o);
        const seats = seatsSummary(
          idxs.map((i) => L.vehicle(rows[i].vehicle_id)?.seats ?? null),
        );
        // 一台车都没有的订单不画红条（卡头已经红字写 no vehicle yet）。
        const short =
          idxs.length > 0 && seats.total !== null && seats.total < o.pax;
        const color = tourColorFor(o.product);
        const pickup = [o.pickup_time, o.pickup_location]
          .filter(Boolean)
          .join(" · ");
        return (
          <section
            key={o.order_number}
            data-order={o.order_number}
            aria-label={o.product}
            style={{ "--c": color } as CSSProperties}
            className="overflow-hidden rounded-xl border-[0.5px] border-l-[5px] border-black/10 border-l-[var(--c)] bg-paper text-[#1a1a1a]"
          >
            <div className="flex flex-col gap-1.5 border-b border-[#e5e7eb] px-5 pt-3.5 pb-3">
              <div className="flex flex-wrap items-center gap-3.5">
                <span
                  aria-hidden
                  className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--c)_16%,var(--paper))] text-[var(--c)]"
                >
                  <BusIcon className="size-[22px]" />
                </span>
                <span className="text-[18px] font-bold tracking-[-.01em] text-[#111827]">
                  {o.product}
                </span>
                <span
                  data-order-seats
                  className={cn(
                    "ml-auto text-[13px] tabular-nums",
                    short || !idxs.length
                      ? "font-semibold text-[#b3261e]"
                      : "text-[#1a1a1a]",
                  )}
                >
                  <b>{o.pax}</b> pax · {seats.text}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-[54px] text-[12.5px] text-[#4a5568]">
                <span>
                  <b className="font-mono text-[12px] text-[#111827]">
                    {o.order_number}
                  </b>
                </span>
                <span>{o.guest_name}</span>
                {pickup ? (
                  <span className="italic">Default pickup: {pickup}</span>
                ) : null}
              </div>
              {short ? (
                <div
                  role="alert"
                  data-private-short
                  className="ml-[54px] rounded-lg border-[0.5px] border-[rgba(179,38,30,.3)] bg-[#fdeceb] px-3 py-2 text-[13px] font-medium text-[#b3261e]"
                >
                  Not enough seats: {o.pax} guests, {seats.total} seats. Add a
                  vehicle.
                </div>
              ) : null}
            </div>
            <div className="px-5 pt-0.5 pb-4 text-[#111827]">
              {idxs.map((i) => renderVan(i))}
              {o.notes ? (
                <div
                  data-order-notes
                  className="mt-3 rounded-lg border-[0.5px] border-[rgba(138,90,0,.28)] bg-[#fdf1dd] px-3 py-2.5 text-[13px] text-[#8a5a00]"
                >
                  <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2.5">
                    <b className="text-[11px] tracking-[.06em] uppercase">
                      Notes
                    </b>
                    <span className="text-[12px] opacity-85">
                      Default pickup time / place may not be right. Read Notes.
                    </span>
                  </div>
                  <p className="m-0 [overflow-wrap:anywhere] whitespace-pre-wrap text-[#5a3b00]">
                    {o.notes}
                  </p>
                </div>
              ) : null}
              <button
                type="button"
                hidden={viewOnly}
                disabled={disabled}
                onClick={() => onAdd(o.order_number)}
                className={cn(ADDVAN, "mt-3.5")}
              >
                + Add vehicle
              </button>
            </div>
          </section>
        );
      })}

      {orphans.length ? (
        <section
          data-private-orphans
          aria-label="Vehicles without an order"
          className="overflow-hidden rounded-xl border-[0.5px] border-l-[5px] border-black/10 border-l-[#94a3b8] bg-paper text-[#1a1a1a]"
        >
          <div className="flex flex-wrap items-center gap-3.5 border-b border-[#e5e7eb] px-5 pt-3.5 pb-3">
            <span className="text-[18px] font-bold tracking-[-.01em] text-[#111827]">
              Vehicles without an order
            </span>
            <span className="ml-auto text-[13px] tabular-nums">
              <b>{orphans.length}</b>{" "}
              {orphans.length === 1 ? "vehicle" : "vehicles"}
            </span>
          </div>
          <div className="px-5 pt-0.5 pb-4 text-[#111827]">
            {orphans.map((i) => renderVan(i))}
            <button
              type="button"
              hidden={viewOnly}
              disabled={disabled}
              onClick={() => onAdd()}
              className={cn(ADDVAN, "mt-3.5")}
            >
              + Add vehicle
            </button>
          </div>
        </section>
      ) : null}

      {!orders.length && !orphans.length ? (
        <section className="rounded-xl border-[0.5px] border-black/10 bg-paper px-5 py-5 text-center text-[#1a1a1a]">
          <p className="m-0 mb-3 text-[14px] font-semibold">
            No Private orders for this day
          </p>
          <button
            type="button"
            hidden={viewOnly}
            disabled={disabled}
            onClick={() => onAdd()}
            className={ADDVAN}
          >
            + Add vehicle
          </button>
        </section>
      ) : null}
    </div>
  );
}
