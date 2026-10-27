"use client";

import { useEffect, useState } from "react";

import { describeError } from "@/lib/api-errors";
import { patchFarmOutOrder } from "@/lib/farm-out-api";
import {
  formatMoney,
  formatTime,
  parseMoney,
  parseTime,
} from "@/lib/farm-out-time";
import { cn } from "@/lib/utils";
import type { SeatingBus, SeatingOrder, SeatingTour } from "@/types";
import type { FarmOutLocation } from "@/types/farm-out";

import { plural, readDrag, SEAT_DRAG, type SeatMove } from "./seating";
import { usePartnerLocations } from "./use-farm-out";

/**
 * Farm out 车下面的名单（G40）：每单选一个酒店（这家公司自己的上车点）、集合 / 发车时间（按时刻表自动算、可改）、
 * 应付金额（自动算、可改）；改过的框蓝边。名单默认收起，一行「N orders · N guests」。
 * 改了就存（`PATCH /api/farm-out/orders/{order}`），存好重读 Seat guests。
 */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function sentLabel(o: SeatingOrder): string | null {
  const f = o.farm_out;
  if (!f?.notice_sent_at) return null;
  return `Notice sent${f.notice_sent_by ? ` by ${f.notice_sent_by}` : ""} on ${whenText(f.notice_sent_at)}`;
}

const INPUT =
  "h-7 rounded-md border-[0.5px] bg-paper px-1.5 text-[12.5px] disabled:opacity-60";

/** 一个可改的文字格：失焦 / 回车才提交；读不懂的标红、恢复原值。 */
function EditCell({
  label,
  value,
  staffSet,
  width,
  disabled,
  parse,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  staffSet: boolean;
  width: string;
  disabled: boolean;
  parse: (raw: string) => string | number | null;
  /** null = 交回自动（后端 PATCH 传 null）：staff 改过的格子清空就是这个。 */
  onCommit: (v: string | number | null) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(value), [value]);
  function commit() {
    if (draft.trim() === value.trim()) {
      setBad(false);
      return;
    }
    const v = parse(draft);
    if (v === "" && staffSet) {
      // 清空一个 staff 改过的格子 = 交回自动（时间按时刻表、应付按结算价重算）。
      setBad(false);
      onCommit(null);
      return;
    }
    if (v === null || v === "") {
      setBad(true);
      setDraft(value);
      return;
    }
    setBad(false);
    onCommit(v);
  }
  return (
    <input
      aria-label={label}
      title={
        staffSet
          ? "Changed by staff. Clear the box to go back to automatic."
          : undefined
      }
      disabled={disabled}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cn(
        INPUT,
        width,
        bad
          ? "border-[#b3261e] bg-[#fdecec]"
          : staffSet
            ? "border-[#1d4ed8] bg-[#eef4ff]"
            : "border-black/25",
      )}
    />
  );
}

export function FarmOutGuests({
  tour,
  bus,
  date,
  partnerId,
  disabled,
  onMove,
  onChanged,
  onSend,
  openSignal,
}: {
  tour: SeatingTour;
  bus: SeatingBus;
  date: string;
  partnerId: number | null;
  disabled: boolean;
  onMove: (m: SeatMove) => void;
  /** 存好一单的改动后（重读 Seat guests）。 */
  onChanged: () => void;
  /** 点 Send farm out notice…：这台车上的订单。没有 = 不出这个键（farm_out_dispatch 开关对我关着）。 */
  onSend?: (orders: SeatingOrder[]) => void;
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const locs = usePartnerLocations(partnerId);
  const locList: FarmOutLocation[] = locs.state === "ready" ? locs.data : [];
  const orders = tour.orders.filter((o) => o.bus_label === bus.label);
  const guests = orders.reduce((n, o) => n + o.pax, 0);
  const sent = orders.filter((o) => o.farm_out?.notice_sent_at).length;
  const hotelless = orders.filter(
    (o) => o.farm_out && o.farm_out.partner_location_id == null,
  );
  // 还没设好的（上线后 admin 要先建合作公司 / 上车点 / 价格）：只说一句，不报错。
  const noLocations =
    partnerId != null && locs.state === "ready" && locList.length === 0;
  const locationsUnavailable = partnerId != null && locs.state === "none";
  const noPayable = orders.filter(
    (o) =>
      o.farm_out &&
      o.farm_out.payable_amount == null &&
      !o.farm_out.payable_set_by_staff,
  ).length;
  const others = tour.buses.filter(
    (b): b is SeatingBus & { label: string } => !!b.label,
  );

  async function patch(
    o: SeatingOrder,
    p: Parameters<typeof patchFarmOutOrder>[3],
  ) {
    if (!o.order_number) return;
    setErr(null);
    setSaving(true);
    try {
      await patchFarmOutOrder(o.order_number, date, tour.manifest_id, p);
      onChanged();
    } catch (e) {
      setErr(`${o.name || o.order_number}: ${describeError(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const off = disabled || saving;
  return (
    <div
      data-farm-out-guests={`${tour.manifest_id}:${bus.label ?? ""}`}
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
        "mt-1.5 rounded-[10px] border border-[#cbd5e1] bg-paper",
        over && "border-[#475569] shadow-[0_0_0_2px_rgba(71,85,105,.3)]",
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
          {plural(orders.length, "order")} · {plural(guests, "guest")}
        </span>
        <span className="ml-auto text-[12px] font-[650] text-[#475569]">
          Farm out
          {sent ? ` · ${plural(sent, "notice")} sent` : ""}
        </span>
      </button>
      {open ? (
        orders.length ? (
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full min-w-[920px] border-collapse text-[12.5px] tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-semibold">
                  {[
                    "Guest · Order",
                    "OTA conf#",
                    "Adult / Child / Infant",
                    "Pick-up hotel",
                    "Check-in",
                    "Departs",
                    "Payable",
                    "Bus",
                  ].map((h) => (
                    <th
                      key={h}
                      className="border-b-[0.5px] border-black/[.08] px-2 py-1.5"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const f = o.farm_out;
                  const label = sentLabel(o);
                  const editable = !!f && !!o.order_number;
                  return (
                    <tr
                      key={o.guest_ids.join("-")}
                      data-farm-order={o.order_number ?? ""}
                      className={cn(
                        "border-b-[0.5px] border-black/[.06] align-top",
                        label && "bg-[#fff8e1]",
                      )}
                    >
                      <td className="px-2 py-2">
                        <b>{o.name || "—"}</b>{" "}
                        <span className="text-[#555]">{o.order_number}</span>
                        {label ? (
                          <>
                            <br />
                            <span className="mr-1 inline-block rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] text-[#BA7517]">
                              {label}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {o.ota_conf_number ?? o.order_number ?? "—"}
                        {o.ota_conf_number &&
                        o.ota_conf_number === o.order_number ? (
                          <span className="ml-1 text-[11px] text-[#777]">
                            (no OTA#)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {o.adult != null
                          ? `${o.adult} / ${o.child ?? 0} / ${o.infant ?? 0}`
                          : o.pax}
                      </td>
                      <td className="px-2 py-2">
                        {editable ? (
                          <select
                            aria-label={`Pick-up hotel for ${o.name || o.order_number}`}
                            disabled={off}
                            value={f.partner_location_id ?? ""}
                            onChange={(e) =>
                              void patch(o, {
                                partner_location_id: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                            className={cn(
                              "h-7 max-w-[190px] rounded-md px-1",
                              f.partner_location_id == null
                                ? "border border-dashed border-[#e7b75a] bg-[#fdf6e7] text-[#8a5a00]"
                                : "border-[0.5px] border-black/25 bg-paper",
                            )}
                          >
                            <option value="">Choose hotel…</option>
                            {locList.map((l) =>
                              l.id == null ? null : (
                                <option key={l.id} value={l.id}>
                                  {l.hotel_name}
                                  {l.spot ? ` · ${l.spot}` : ""}
                                </option>
                              ),
                            )}
                          </select>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editable && f.partner_location_id != null ? (
                          <EditCell
                            label={`Check-in time for ${o.name || o.order_number}`}
                            value={formatTime(f.checkin_time)}
                            staffSet={f.checkin_time_set_by_staff}
                            width="w-[84px]"
                            disabled={off}
                            parse={(r) => parseTime(r) as string | null}
                            onCommit={(v) =>
                              void patch(o, {
                                checkin_time: v == null ? null : String(v),
                              })
                            }
                          />
                        ) : (
                          <span className="text-[#999]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editable && f.partner_location_id != null ? (
                          <EditCell
                            label={`Departure time for ${o.name || o.order_number}`}
                            value={formatTime(f.depart_time)}
                            staffSet={f.depart_time_set_by_staff}
                            width="w-[84px]"
                            disabled={off}
                            parse={(r) => parseTime(r) as string | null}
                            onCommit={(v) =>
                              void patch(o, {
                                depart_time: v == null ? null : String(v),
                              })
                            }
                          />
                        ) : (
                          <span className="text-[#999]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editable ? (
                          <EditCell
                            label={`Payable for ${o.name || o.order_number}`}
                            value={formatMoney(f.payable_amount)}
                            staffSet={f.payable_set_by_staff}
                            width="w-[84px]"
                            disabled={off}
                            placeholder="—"
                            parse={(r) => parseMoney(r) as number | null}
                            onCommit={(v) =>
                              void patch(o, {
                                payable_amount: v == null ? null : Number(v),
                              })
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <select
                          aria-label={`Bus for ${o.name || o.order_number || "this order"}`}
                          disabled={disabled}
                          value={o.bus_label ?? ""}
                          onChange={(e) => {
                            if (e.target.value)
                              onMove({ order: o, to: e.target.value });
                          }}
                          className="h-6 rounded-md border-[0.5px] border-black/25 bg-paper px-1 text-[11.5px] disabled:opacity-60"
                        >
                          {others.map((b) => (
                            <option key={b.label} value={b.label}>
                              {b.farm_out ? "Farm out" : `Bus ${b.label}`}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {orders
                  .filter(
                    (o) =>
                      o.farm_out &&
                      (o.farm_out.payable_changed_by ||
                        o.farm_out.checkin_time_set_by_staff ||
                        o.farm_out.depart_time_set_by_staff),
                  )
                  .map((o) => {
                    const f = o.farm_out!;
                    const what = [
                      f.checkin_time_set_by_staff || f.depart_time_set_by_staff
                        ? "times"
                        : null,
                      f.payable_set_by_staff ? "payable" : null,
                    ].filter(Boolean);
                    return (
                      <tr key={`n-${o.guest_ids.join("-")}`}>
                        <td
                          colSpan={8}
                          className="px-2 pb-2 text-[11px] text-[#1d4ed8]"
                        >
                          {o.name || o.order_number}: changed by staff
                          {what.length ? ` — ${what.join(", ")}` : ""}
                          {f.payable_changed_by
                            ? ` (${f.payable_changed_by}, ${whenText(f.payable_changed_at)})`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {err ? (
              <p role="alert" className="mt-1 mb-0 text-[12px] text-[#b3261e]">
                {err}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-3 border-t-[0.5px] border-black/[.07] px-1 pt-2.5">
              {noLocations ? (
                <span data-no-locations className="text-[12px] text-[#8a5a00]">
                  This partner has no pick-up hotels yet. Add them in Settings →
                  Farm out Partners.
                </span>
              ) : locationsUnavailable ? (
                <span data-no-locations className="text-[12px] text-[#8a5a00]">
                  The hotel list could not be loaded here. An admin sets pick-up
                  hotels in Supplier → Partners.
                </span>
              ) : null}
              {noPayable ? (
                <span data-no-payable className="text-[12px] text-[#8a5a00]">
                  Payable is not set for {plural(noPayable, "order")}. Add this
                  tour’s prices in Supplier → Partners, or type an
                  amount.
                </span>
              ) : null}
              {hotelless.map((o) => (
                <span
                  key={o.guest_ids.join("-")}
                  className="text-[12px] text-[#b3261e]"
                >
                  {o.name || o.order_number} ({o.order_number}): choose a
                  pick-up hotel before sending.
                </span>
              ))}
              {onSend ? (
                <button
                  type="button"
                  data-farm-out-send
                  disabled={disabled}
                  onClick={() => onSend(orders)}
                  className="ml-auto h-8 rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
                >
                  Send farm out notice…
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="m-0 px-3 pb-2 text-[12px] text-[#1a1a1a]">
            No guests on this vehicle. Drag an order here, or pick Farm out in
            an order’s bus menu.
          </p>
        )
      ) : null}
    </div>
  );
}
