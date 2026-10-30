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
import type { ManifestLunchMismatch } from "@/types";

export type MismatchAction = "print" | "download";

const VERB: Record<MismatchAction, [title: string, button: string]> = {
  print: ["Print Bus Manifest", "Print anyway"],
  download: ["Download Bus Manifest", "Download anyway"],
};

/**
 * 餐份数和人数对不上时，打印 / 下载前先弹的提醒（Annie 10-28 定 12、Q21「打印 / 下载前也提醒」）。
 * 样子照发送页的黄框 + 表格（tickets-send/legacy-ui，同 preview ⑦），一天里几辆车的单列在一个框里。
 * 「… anyway」是提交键（蓝色），Cancel 灰框回到页面去查。
 */
export function LunchMismatchDialog({
  action,
  dateLabel,
  orders,
  onCancel,
  onConfirm,
}: {
  action: MismatchAction;
  dateLabel: string;
  orders: ManifestLunchMismatch[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [title, button] = VERB[action];
  const n = orders.length;
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
        <div className={YELLOW_BOX}>
          <b>
            {n} booking{n === 1 ? "" : "s"}: lunch doesn&rsquo;t match pax.
          </b>
          <br />
          Check {n === 1 ? "it" : "them"} before you{" "}
          {action === "print" ? "print" : "download"}, or {button.toLowerCase()}
          .
        </div>
        <div className="mt-3 overflow-hidden rounded-[10px] border-[0.5px] border-black/10">
          <div className="border-b-[0.5px] border-black/[.08] px-2.5 py-2 text-[12px] font-semibold text-[#1a1a1a]">
            Lunch doesn&rsquo;t match pax
          </div>
          <div className={`${TABLE_WRAP} max-h-[50vh] overflow-y-auto`}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
