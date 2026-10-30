"use client";

import { type DragEvent, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { SeatingBus, SeatingOrder, SeatingTour } from "@/types";
import { useViewOnly } from "@/components/ui/view-only";

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

export const SEAT_DRAG = "application/x-npe-seat";

export interface SeatMove {
  order: SeatingOrder;
  /** null = Auto。 */
  to: string | null;
}

function sum(orders: SeatingOrder[]) {
  return orders.reduce((n, o) => n + o.pax, 0);
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * 团类型键的显示名。Annie 2026-10-29：「X是对的，A28应该是Lower 28， A20应该是Upper20」「空间足够大，所以用Lower 28 / Upper 20」
 * ⇒ Upper / Lower 写全称，X 照旧（10-18 定的是 U / L / X）。后端实际给的键是 upper_antelope / lower_antelope
 * （原来只认 upper / lower，对不上就取最后一段首字母，两个都成了「A」）；upper / lower 也留着。没见过的键取最后一段的首字母。
 */
const TYPE_SHORT: Record<string, string> = {
  upper_antelope: "Upper",
  lower_antelope: "Lower",
  upper: "Upper",
  lower: "Lower",
  antelope_x: "X",
};
const TYPE_ORDER = [
  "upper_antelope",
  "upper",
  "lower_antelope",
  "lower",
  "antelope_x",
];

export function typeShort(key: string): string {
  return (
    TYPE_SHORT[key] ?? (key.split("_").pop() ?? key).charAt(0).toUpperCase()
  );
}

/** 这个团订单里出现过的类型键（U / L / X 在前）；一种也放（Annie：每台车都放），一种都没有才不放。 */
export function tourTypeKeys(orders: SeatingOrder[]): string[] {
  const seen = new Set(orders.flatMap((o) => o.tour_types ?? []));
  if (seen.size < 1) return [];
  return [...seen].sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a);
    const ib = TYPE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

/** 一张订单：名字、单号、几位、接客时间地点；下拉换车；可拖到同一团的另一台车。 */
function OrderLine({
  tour,
  order,
  disabled,
  onMove,
  day,
  selected = false,
  onSelect,
  selectedIds,
}: {
  tour: SeatingTour;
  order: SeatingOrder;
  disabled: boolean;
  onMove: (m: SeatMove) => void;
  day: SeatDayState;
  /** Arrange seats：这张订单勾上了没有；没给 onSelect = 没有勾选框。 */
  selected?: boolean;
  onSelect?: (v: boolean) => void;
  /** 拖的这张已勾选时，所有已勾选的订单的客人一起走。 */
  selectedIds?: () => number[];
}) {
  const buses = tour.buses.filter(
    (b): b is SeatingBus & { label: string } => !!b.label,
  );
  const viewOnly = useViewOnly();
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
            ids: selected && selectedIds ? selectedIds() : order.guest_ids,
            from: order.bus_label,
          }),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-lg border-[0.5px] px-2.5 py-1.5 text-[12.5px]",
        selected ? "border-[#b5d4f4] bg-[#eaf2ff]" : "border-black/15 bg-paper",
        !disabled && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="truncate font-semibold">
        {onSelect ? (
          <input
            type="checkbox"
            data-seat-select
            aria-label={`Select ${order.name || order.order_number || "this order"}`}
            checked={selected}
            disabled={disabled}
            onChange={(e) => onSelect(e.target.checked)}
            className="mr-1.5 align-[-2px]"
          />
        ) : null}
        {order.name || "—"}
        {order.order_number ? (
          <span className="ml-1.5 font-normal text-[#1a1a1a]">
            {order.order_number}
          </span>
        ) : null}
      </span>
      <span className="font-bold tabular-nums">{order.pax}</span>
      <span className="truncate text-[11.5px] text-[#1a1a1a]">{where}</span>
      {viewOnly ? null : day.completed ? (
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
              {b.farm_out ? "Farm out" : `Bus ${b.label}`} (
              {b.capacity == null ? b.pax : `${b.pax} / ${b.capacity}`})
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
              {b.farm_out ? "Farm out" : `Bus ${b.label}`}
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

export function readDrag(
  e: DragEvent,
): { m: number; ids: number[]; from: string | null } | null {
  try {
    const raw = e.dataTransfer.getData(SEAT_DRAG);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Arrange seats（Annie 2026-10-17 夜，原来叫 Seat guests）：同一个团的车并排成列（Bus A、Bus B、Farm out、Not on a bus），
 * 每列顶上写「已坐 / 座位」和一条进度条，订单前有勾选框；勾选后用「Move N selected orders」一次挪走，
 * 拖其中一张已勾选的订单，所有已勾选的跟着走。挪过去以后两边数字马上变（先改页面上的数，同时存；存失败变回去）。
 * 只在这个团的车字母都填好（lettered）时有；Farm out 车的酒店 / 时间 / 应付表仍在那台车下面（FarmOutGuests）。
 */
export function ArrangeBoard({
  tour,
  disabled: busyDisabled,
  onMoveMany,
  day = OPEN_DAY,
}: {
  tour: SeatingTour;
  disabled: boolean;
  onMoveMany: (orders: SeatingOrder[], to: string | null) => Promise<boolean>;
  day?: SeatDayState;
}) {
  // 只看（partner）：不能拖、不能勾、不能挪；按团类型筛选照样能用。
  const viewOnly = useViewOnly();
  const disabled = busyDisabled || viewOnly;
  const keyOf = (o: SeatingOrder) => o.guest_ids.join("-");
  const [sel, setSel] = useState<Set<string>>(new Set());
  // 先改页面上的数：订单 → 挪去的车（Auto 不先改，后端定）。重读到新名单就撤掉。
  const [pending, setPending] = useState<Record<string, string> | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  // 每台车自己的团类型筛选（车的字母 → 类型键）；没筛 = All。
  const [typeOf, setTypeOf] = useState<Record<string, string>>({});
  const typeKeys = tourTypeKeys(tour.orders);
  useEffect(() => {
    setPending(null);
    setSel((cur) => {
      const keep = new Set(
        [...cur].filter((k) => tour.orders.some((o) => keyOf(o) === k)),
      );
      return keep.size === cur.size ? cur : keep;
    });
  }, [tour.orders]);

  const eff = (o: SeatingOrder) => pending?.[keyOf(o)] ?? o.bus_label;
  const buses = tour.buses.filter(
    (b): b is SeatingBus & { label: string } => !!b.label,
  );
  const unplaced = tour.orders.filter((o) => eff(o) === null);
  const picked = tour.orders.filter((o) => sel.has(keyOf(o)));

  async function move(orders: SeatingOrder[], to: string | null) {
    if (!orders.length || disabled) return;
    if (to !== null)
      setPending((cur) => ({
        ...(cur ?? {}),
        ...Object.fromEntries(orders.map((o) => [keyOf(o), to])),
      }));
    const ok = await onMoveMany(orders, to);
    if (!ok) setPending(null);
    else setSel(new Set());
  }

  const lineProps = (o: SeatingOrder) => ({
    tour,
    order: { ...o, bus_label: eff(o) },
    disabled,
    day,
    onMove: ({ to }: SeatMove) => void move([o], to),
    selected: sel.has(keyOf(o)),
    onSelect: viewOnly
      ? undefined
      : (v: boolean) =>
          setSel((cur) => {
            const next = new Set(cur);
            if (v) next.add(keyOf(o));
            else next.delete(keyOf(o));
            return next;
          }),
    selectedIds: () => picked.flatMap((p) => p.guest_ids),
  });

  return (
    <div
      data-arrange-board={tour.manifest_id}
      className="mt-2.5 rounded-xl border border-[#dfe3e8] bg-white p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2.5 text-[13px]">
        <b className="text-[14px]">Arrange seats</b>
        <span className="text-[12px] text-[#6b7280]">
          {plural(tour.pax, "guest")} · tick orders or drag them to move
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2.5">
        {buses.map((b) => {
          const mine = tour.orders.filter((o) => eff(o) === b.label);
          const pax = sum(mine);
          const tf = typeOf[b.label];
          const shown = tf
            ? mine.filter((o) => o.tour_types?.includes(tf))
            : mine;
          const full = b.capacity != null && pax > b.capacity;
          const farm = !!b.farm_out;
          return (
            <div
              key={b.label}
              data-arrange-col={`${tour.manifest_id}:${b.label}`}
              {...(farm
                ? {}
                : { "data-bus-guests": `${tour.manifest_id}:${b.label}` })}
              onDragOver={(e) => {
                if (disabled || !e.dataTransfer.types.includes(SEAT_DRAG))
                  return;
                e.preventDefault();
                setOver(b.label);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                const d = readDrag(e);
                if (!d || d.m !== tour.manifest_id) return;
                e.preventDefault();
                const ids = new Set(d.ids);
                void move(
                  tour.orders.filter(
                    (o) =>
                      o.guest_ids.every((g) => ids.has(g)) &&
                      eff(o) !== b.label,
                  ),
                  b.label,
                );
              }}
              className={cn(
                "min-w-0 rounded-[10px] border p-2",
                farm
                  ? "border-[#94a3b8] bg-[#f1f5f9]"
                  : "border-[#dfe3e8] bg-white",
                over === b.label &&
                  "border-[#3b82f6] shadow-[0_0_0_2px_rgba(59,130,246,.25)]",
              )}
            >
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <b className="truncate">
                  {farm
                    ? `Farm out${b.partner_name ? ` · ${b.partner_name}` : ""}`
                    : `Bus ${b.label}${b.van ? ` · #${b.van}` : ""}`}
                </b>
                <span
                  data-arrange-count
                  className={cn(
                    "font-bold whitespace-nowrap tabular-nums",
                    full
                      ? "text-[#b3261e]"
                      : farm
                        ? "text-[#475569]"
                        : "text-[#1e6b43]",
                  )}
                >
                  {b.capacity == null
                    ? plural(pax, "guest")
                    : `${pax} / ${b.capacity} seats`}
                </span>
              </div>
              {b.capacity != null ? (
                <div className="my-1.5 h-[5px] overflow-hidden rounded-[3px] bg-[#e5e7eb]">
                  <div
                    className={cn(
                      "h-[5px] rounded-[3px]",
                      full ? "bg-[#b3261e]" : "bg-[#1e6b43]",
                    )}
                    style={{
                      width: `${Math.min(100, (pax / Math.max(1, b.capacity)) * 100)}%`,
                    }}
                  />
                </div>
              ) : (
                <div className="h-1.5" />
              )}
              {typeKeys.length ? (
                <div
                  data-type-keys={`${tour.manifest_id}:${b.label}`}
                  className="mb-1.5 flex flex-wrap gap-1"
                >
                  {[null, ...typeKeys].map((k) => {
                    const on = (tf ?? null) === k;
                    const n = k
                      ? sum(mine.filter((o) => o.tour_types?.includes(k)))
                      : pax;
                    return (
                      <button
                        key={k ?? "all"}
                        type="button"
                        data-type-key={k ?? "all"}
                        title={k ?? "All tours"}
                        disabled={busyDisabled}
                        onClick={() => {
                          setTypeOf((cur) => {
                            const next = { ...cur };
                            if (k) next[b.label] = k;
                            else delete next[b.label];
                            return next;
                          });
                          // 点一种：这台车上这种的订单全部自动勾上（其余车的勾选清掉）；点 All：这台车的勾选取消。
                          setSel(
                            k
                              ? new Set(
                                  mine
                                    .filter((o) => o.tour_types?.includes(k))
                                    .map(keyOf),
                                )
                              : new Set(),
                          );
                        }}
                        className={cn(
                          "h-6 cursor-pointer rounded-md border px-2 text-[11.5px] font-semibold tabular-nums disabled:cursor-not-allowed disabled:opacity-50",
                          on
                            ? "border-[#3b82f6] bg-[#3b82f6] text-white"
                            : "border-[#cbd2dc] bg-white text-[#1a1a1a]",
                        )}
                      >
                        {k ? typeShort(k) : "All"} {n}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="mb-1 text-[11.5px] text-[#6b7280]">
                {tf
                  ? `${plural(shown.length, "order")} of ${mine.length}`
                  : plural(mine.length, "order")}
              </div>
              {shown.length ? (
                <ul className="m-0 flex max-h-[320px] list-none flex-col gap-1.5 overflow-y-auto p-0">
                  {shown.map((o) => (
                    <OrderLine key={keyOf(o)} {...lineProps(o)} />
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[12px] text-[#6b7280]">
                  No guests on this {farm ? "vehicle" : "bus"}. Drag an order
                  here.
                </p>
              )}
            </div>
          );
        })}
        {unplaced.length ? (
          <div
            data-unplaced={tour.manifest_id}
            data-arrange-col={`${tour.manifest_id}:none`}
            className="min-w-0 rounded-[10px] border border-[#f3c98b] bg-[#fff6eb] p-2"
          >
            <div className="flex items-baseline justify-between gap-2 text-[12.5px] text-[#8a5a00]">
              <b>Not on a bus</b>
              <span className="font-bold whitespace-nowrap">
                {plural(unplaced.length, "order")} ·{" "}
                {plural(sum(unplaced), "guest")}
              </span>
            </div>
            <div className="mt-1 mb-1.5 text-[11.5px] text-[#8a5a00]">
              {day.completed
                ? "Completed: pick a bus for each order"
                : "No room on today’s buses"}
            </div>
            <ul className="m-0 flex max-h-[320px] list-none flex-col gap-1.5 overflow-y-auto p-0">
              {unplaced.map((o) => (
                <OrderLine key={keyOf(o)} {...lineProps(o)} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div
        hidden={viewOnly}
        className="mt-2.5 flex flex-wrap items-center gap-2 border-t-[0.5px] border-black/[.09] pt-2.5 text-[12.5px]"
      >
        <select
          aria-label="Move selected orders to"
          data-move-target
          disabled={disabled || !picked.length}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="h-[30px] min-w-[170px] rounded-[7px] border border-[#cbd2dc] bg-white px-2 text-[12.5px] disabled:opacity-50"
        >
          <option value="">
            {picked.length
              ? `Move selected (${picked.length}) to…`
              : "Tick orders to move"}
          </option>
          {buses.map((b) => (
            <option key={b.label} value={b.label}>
              {b.farm_out ? "Farm out" : `Bus ${b.label}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-move-selected
          disabled={disabled || !picked.length || !target}
          onClick={() => {
            const to = target;
            setTarget("");
            void move(picked, to);
          }}
          className="h-[30px] cursor-pointer rounded-[7px] border border-[#3b82f6] bg-[#3b82f6] px-3 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Move {picked.length || ""} selected{" "}
          {picked.length === 1 ? "order" : "orders"}
        </button>
        {picked.length ? (
          <button
            type="button"
            onClick={() => setSel(new Set())}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-[#185fa5] underline"
          >
            Clear
          </button>
        ) : null}
      </div>
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
 * 团标题行右边的小黄字（Annie 2026-10-17 夜）：这个团的名单 / 车字母有什么要注意的。
 * **没客人的团一句都不写**（原来的「No guest list for this tour yet」整句取消）；当天有客人才有。
 */
export function seatNotes(
  tour: SeatingTour | undefined,
  dirty: boolean,
): string[] {
  if (!tour || !tour.uploaded || !tour.pax) return [];
  const notes: string[] = [];
  if (tour.mode === "unlettered")
    notes.push("Give each bus a different letter to arrange seats");
  if (dirty)
    notes.push(
      "Guests are seated on the saved schedule; they update once your changes are saved",
    );
  return notes;
}

/** 一个团的车下面：挪车出错的原因（板和 Farm out 名单共用）。 */
export function TourSeatingNotes({
  tour,
  error,
}: {
  tour: SeatingTour | undefined;
  error: string | null;
}) {
  if (!error) return null;
  return (
    <div
      className="mt-2 flex flex-col gap-1.5"
      data-seat-notes={tour?.manifest_id}
    >
      <p role="alert" className="m-0 text-[12.5px] text-[#b3261e]">
        {error}
      </p>
    </div>
  );
}
