"use client";

import { Modal } from "@/components/ui/modal";
import {
  LIGHT_BUTTON,
  sendButtonClass,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
import { lunchShort } from "@/lib/guest-lunch";
import type { ManifestGuestLunchDiffers, ManifestLunchMismatch } from "@/types";

export type MismatchAction = "print" | "download";

const VERB: Record<MismatchAction, [title: string, button: string]> = {
  print: ["Print Bus Manifest", "Print anyway"],
  download: ["Download Bus Manifest", "Download anyway"],
};

/**
 * 餐份数和人数对不上时，打印 / 下载前先弹的提醒（Annie 10-28 定 12、Q21「打印 / 下载前也提醒」）。
 * 样子照发送页的黄框 + 表格（tickets-send/legacy-ui，同 preview ⑦），一天里几辆车的单列在一个框里。
 * 「… anyway」是提交键（蓝色），Cancel 灰框回到页面去查。
 *
 * G364 Q3 A（Annie 2026-11-19「动手」，preview 第 7 版）：客人在确认页选的餐跟 Bus manifest 不一样的单（后端每车
 * `guest_lunch_differs_orders`）放第二张表；只有这一种也弹框。只提醒，按「… anyway」照常继续。
 */
export function LunchMismatchDialog({
  action,
  dateLabel,
  orders,
  differs = [],
  onCancel,
  onConfirm,
}: {
  action: MismatchAction;
  dateLabel: string;
  orders: ManifestLunchMismatch[];
  differs?: ManifestGuestLunchDiffers[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [title, button] = VERB[action];
  const n = orders.length;
  // G333（preview Nu5iBNZDo9NqVyqyPxVXRf ③）：有「不带餐却写了三明治」的单 ⇒ 黄框标题多半句，Lunch 栏下面写原因。
  const anyNoLunch = orders.some((o) => !!o.reason);
  const d = differs.length;
  const differsHead =
    d === 1
      ? "1 booking: the guest’s lunch pick differs from the Bus manifest."
      : `${d} bookings: the guests’ lunch picks differ from the Bus manifest.`;
  // 两张表都有时各占一半高，整个框不超出屏幕。
  const tableHeight = n && d ? "max-h-[28vh]" : "max-h-[50vh]";
  return (
    <Modal
      titleId="lunch-mismatch-title"
      onDismiss={onCancel}
      panelClassName="max-w-[640px] p-5"
    >
      <div data-lunch-mismatch-dialog>
        <h2
          id="lunch-mismatch-title"
          className="mb-3 text-[15px] font-semibold text-[#1a1a1a]"
        >
          {title} · {dateLabel}
        </h2>
        <div className={YELLOW_BOX} data-mismatch-yellow>
          {n ? (
            <>
              <b>
                {n} booking{n === 1 ? "" : "s"}: lunch doesn&rsquo;t match pax
                {anyNoLunch ? ", or sandwiches on a booking without lunch" : ""}
                .
              </b>
              <br />
              Check {n === 1 ? "it" : "them"} before you{" "}
              {action === "print" ? "print" : "download"}, or{" "}
              {button.toLowerCase()}.
            </>
          ) : null}
          {n && d ? (
            <>
              <br />
              <b>{differsHead}</b> The lunch in Rezdy is probably wrong: check
              it and fix Special Requirements in Rezdy.
            </>
          ) : null}
          {!n && d ? (
            <>
              <b>{differsHead}</b>
              <br />
              The lunch in Rezdy is probably wrong. Check it and fix Special
              Requirements in Rezdy, or {button.toLowerCase()}.
            </>
          ) : null}
        </div>
        {n ? (
          <div className="mt-3 overflow-hidden rounded-[10px] border-[0.5px] border-black/10">
            <div className="border-b-[0.5px] border-black/[.08] px-2.5 py-2 text-[12px] font-semibold text-[#1a1a1a]">
              Lunch doesn&rsquo;t match pax
            </div>
            <div className={`${TABLE_WRAP} ${tableHeight} overflow-y-auto`}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    {["Bus / Tour", "Order #", "Guest", "Pax", "Lunch"].map(
                      (h) => (
                        <th key={h} className={TH}>
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr
                      key={`${o.bus_label}-${o.order_number}`}
                      data-mismatch-row={o.order_number}
                      className={TR}
                    >
                      <td className={TD}>
                        {o.bus_label} · {o.tour}
                      </td>
                      <td className={TD}>{o.order_number}</td>
                      <td className={TD}>{o.guest}</td>
                      <td className={TD}>{o.pax}</td>
                      <td className={`${TD} font-semibold text-[#c00000]`}>
                        {o.lunch_text || "-"}
                        {o.reason ? (
                          <span
                            data-mismatch-reason
                            className="block text-[11.5px] leading-[1.3] font-medium whitespace-normal"
                          >
                            {o.reason}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {d ? (
          <div
            data-guest-lunch-table
            className="mt-3 overflow-hidden rounded-[10px] border-[0.5px] border-black/10"
          >
            <div className="border-b-[0.5px] border-black/[.08] px-2.5 py-2 text-[12px] font-semibold text-[#c2410c]">
              Guest&rsquo;s lunch pick differs from the Bus manifest
            </div>
            <div className={`${TABLE_WRAP} ${tableHeight} overflow-y-auto`}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    {[
                      "Bus / Tour",
                      "Order #",
                      "Guest",
                      "Pax",
                      "Guest picked",
                      "Bus manifest",
                    ].map((h) => (
                      <th key={h} className={TH}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {differs.map((o) => (
                    <tr
                      key={`${o.bus_label}-${o.order_number}`}
                      data-guest-lunch-row={o.order_number}
                      className={TR}
                    >
                      <td className={TD}>
                        {o.bus_label} · {o.tour}
                      </td>
                      <td className={TD}>{o.order_number}</td>
                      <td className={TD}>{o.guest}</td>
                      <td className={TD}>{o.pax}</td>
                      <td className={`${TD} font-semibold text-[#c2410c]`}>
                        {(o.guest_lunch && lunchShort(o.guest_lunch)) || "-"}
                      </td>
                      <td className={TD}>
                        {(o.manifest_lunch && lunchShort(o.manifest_lunch)) ||
                          "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} className={LIGHT_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            data-mismatch-go
            onClick={onConfirm}
            className={sendButtonClass("blue")}
          >
            {button}
          </button>
        </div>
      </div>
    </Modal>
  );
}
