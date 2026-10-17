"use client";

import { useEffect, useState } from "react";

import {
  fetchFarmOutPartnerSpots,
  saveFarmOutOrderDetail,
} from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type { FarmOutOrderDetail, SeatingOrder } from "@/types";

import { FarmOutSendDialog } from "../farm-out/send-dialog";

const CELL = "px-2 py-[7px] align-top";

/**
 * Farm out 车下面，逐单的转单明细（G40）：上车点（这家公司自己的一套，不是我们的酒店）、
 * 集合 / 发车时间（选了酒店自动算，staff 可改）、应付金额（自动算，staff 可改）、发通知。
 * 名单本身（哪些订单坐这台车）还是用现成的 Seat guests（上面那块 BusGuests，拖 / 下拉换车）；
 * 这里只管 Farm out 特有的字段，两块各管各的，不重复实现拖拽。
 */
export function FarmOutOrdersPanel({
  date,
  manifestId,
  tourName,
  partnerId,
  partnerName,
  orders,
  details,
  disabled,
  onChanged,
}: {
  date: string;
  manifestId: number;
  tourName: string;
  partnerId: number;
  partnerName: string;
  /** 这台车上坐的订单（来自 Seat guests：`seat.orders.filter(o => o.bus_label === 这台车的字母)`）。 */
  orders: SeatingOrder[];
  /** 这些订单的 Farm out 明细（来自 `FarmOutDay`，按订单号配对；没有就当「还没设」）。 */
  details: FarmOutOrderDetail[];
  disabled: boolean;
  /** 改完一张单（存好）之后：父组件重拉 Farm out 当天状态。 */
  onChanged: () => void;
}) {
  const [spots, setSpots] = useState<
    { id: number; name: string; departures: Record<number, string> }[] | null
  >(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchFarmOutPartnerSpots(partnerId)
      .then((s) => live && setSpots(s))
      .catch(() => live && setSpots([]));
    return () => {
      live = false;
    };
  }, [partnerId]);

  const detailFor = (orderNumber: string): FarmOutOrderDetail | null =>
    details.find((d) => d.order_number === orderNumber) ?? null;

  async function patch(
    orderNumber: string,
    body: Parameters<typeof saveFarmOutOrderDetail>[2],
  ) {
    setBusyOrder(orderNumber);
    try {
      await saveFarmOutOrderDetail(date, orderNumber, body);
      onChanged();
    } finally {
      setBusyOrder(null);
    }
  }

  const missingSpot = orders.filter(
    (o) => o.order_number && !detailFor(o.order_number)?.pickup_spot_id,
  );

  return (
    <div className="mt-1.5 rounded-[10px] border border-[#dfe3e8] bg-paper">
      <div className="flex flex-wrap items-center gap-2 border-b-[0.5px] border-black/[.07] px-3 py-[7px] text-[12.5px]">
        <span className="font-semibold text-[#1a1a1a]">
          {orders.length} order{orders.length === 1 ? "" : "s"} ·{" "}
          {orders.reduce((n, o) => n + o.pax, 0)} guests
        </span>
        <span className="ml-auto font-[650] text-[#475569]">
          Farm out details
        </span>
      </div>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full min-w-[820px] border-collapse text-[12.5px] text-[#1a1a1a]">
          <thead>
            <tr className="text-left text-[11px] font-semibold">
              <th className={CELL}>Guest · Order</th>
              <th className={CELL}>Pax</th>
              <th className={CELL}>Pick-up hotel</th>
              <th className={CELL}>Check-in</th>
              <th className={CELL}>Departs</th>
              <th className={CELL}>Payable</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const d = o.order_number ? detailFor(o.order_number) : null;
              const busy = busyOrder === o.order_number;
              return (
                <tr
                  key={o.order_number ?? o.guest_ids.join("-")}
                  className={cn(
                    "border-b-[0.5px] border-black/[.06] last:border-b-0",
                    d?.notice_sent_at && "bg-[#fff8e1]",
                  )}
                >
                  <td className={CELL}>
                    <b>{o.name || "—"}</b>{" "}
                    <span className="text-[#1a1a1a]">{o.order_number}</span>
                    {d?.notice_sent_at ? (
                      <div className="mt-0.5 inline-block rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] text-[#BA7517]">
                        Sent by {d.notice_sent_by} on{" "}
                        {new Date(d.notice_sent_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td className={cn(CELL, "tabular-nums")}>{o.pax}</td>
                  <td className={CELL}>
                    <select
                      aria-label={`Pick-up hotel for ${o.name || o.order_number}`}
                      disabled={disabled || busy || !spots}
                      value={d?.pickup_spot_id ?? ""}
                      onChange={(e) =>
                        o.order_number &&
                        void patch(o.order_number, {
                          pickup_spot_id: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                      className={cn(
                        "h-7 rounded-md border-[0.5px] bg-paper px-1 disabled:opacity-60",
                        d?.pickup_spot_id
                          ? "border-black/25"
                          : "border-dashed border-[#e7b75a] bg-[#fdf6e7] text-[#8a5a00]",
                      )}
                    >
                      <option value="">Choose hotel…</option>
                      {(spots ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={CELL}>
                    <input
                      aria-label={`Check-in time for ${o.name || o.order_number}`}
                      disabled={disabled || busy}
                      value={d?.checkin_time ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        o.order_number &&
                        void patch(o.order_number, {
                          checkin_time: e.target.value,
                        })
                      }
                      className={cn(
                        "h-7 w-[84px] rounded-md border-[0.5px] bg-paper px-1.5 disabled:opacity-60",
                        d?.time_edited ? "border-[#1d4ed8] bg-[#eef4ff]" : "border-black/25",
                      )}
                    />
                  </td>
                  <td className={CELL}>
                    <input
                      aria-label={`Departure time for ${o.name || o.order_number}`}
                      disabled={disabled || busy}
                      value={d?.depart_time ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        o.order_number &&
                        void patch(o.order_number, {
                          depart_time: e.target.value,
                        })
                      }
                      className={cn(
                        "h-7 w-[84px] rounded-md border-[0.5px] bg-paper px-1.5 disabled:opacity-60",
                        d?.time_edited ? "border-[#1d4ed8] bg-[#eef4ff]" : "border-black/25",
                      )}
                    />
                  </td>
                  <td className={CELL}>
                    <input
                      aria-label={`Payable amount for ${o.name || o.order_number}`}
                      disabled={disabled || busy}
                      value={d?.payable != null ? `$${d.payable.toFixed(2)}` : ""}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
                        if (o.order_number && Number.isFinite(n))
                          void patch(o.order_number, { payable: n });
                      }}
                      className={cn(
                        "h-7 w-[86px] rounded-md border-[0.5px] bg-paper px-1.5 tabular-nums disabled:opacity-60",
                        d?.payable_edited_by ? "border-[#1d4ed8] bg-[#eef4ff]" : "border-black/25",
                      )}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap items-center gap-3 border-t-[0.5px] border-black/[.07] px-1 pt-2.5">
          {missingSpot.length ? (
            <span className="text-[12px] text-[#b3261e]">
              {missingSpot
                .map((o) => `${o.name || o.order_number}: choose a pick-up hotel before sending.`)
                .join(" ")}
            </span>
          ) : null}
          <button
            type="button"
            disabled={disabled || !orders.length}
            onClick={() => setSendOpen(true)}
            className="ml-auto h-8 cursor-pointer rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 text-[12.5px] font-semibold whitespace-nowrap text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send farm out notice…
          </button>
        </div>
      </div>
      {sendOpen ? (
        <FarmOutSendDialog
          date={date}
          manifestId={manifestId}
          tourName={tourName}
          partnerName={partnerName}
          onClose={() => setSendOpen(false)}
          onSent={() => {
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
