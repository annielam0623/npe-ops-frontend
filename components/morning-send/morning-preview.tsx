import type { ReactNode } from "react";

import {
  DARK_BUTTON,
  PREVIEW_CARD,
  previewHeaderClass,
  RED_BOX,
  SEND_ICON,
  SendTypePicker,
  sendButtonClass,
  TABLE,
  TABLE_WRAP,
} from "@/components/tickets-send/legacy-ui";
import { cn } from "@/lib/utils";
import type {
  MorningManifestRow,
  MorningPartial,
  MorningSendType,
} from "@/types";

import {
  describeAlreadySent,
  formatLaClock,
  groupByLocation,
  SEND_TYPES,
  sendTypeShort,
} from "./config";

/** .sel-bar-btn（Select all 蓝）/ .sel-bar-btn-deselect（Deselect all 橙）。 */
const SEL_BAR_BUTTON =
  "cursor-pointer rounded-[7px] border-[0.5px] px-4 py-[7px] text-[13px] font-semibold text-white";

/**
 * 预览：没发过的按上车地点分组（默认全选）；今天已经发过的放在下面单独一块（默认一个都不勾）。
 * 🔴 Select all 和地点切换只动上面那块——2026-09-15 那次 25 单双发就是 Select all 把已发过的也勾上了。
 * 样子照旧页面 send_morning.html：白卡 + 蓝头；已发过的是深蓝一块（.sent-section）。
 */
export function MorningPreviewStep({
  fileName,
  rows,
  selected,
  onSelectedChange,
  badPax,
  sendType,
  onSendTypeChange,
  onSend,
  onStartOver,
}: {
  fileName: string;
  rows: MorningManifestRow[];
  selected: ReadonlySet<string>;
  onSelectedChange: (value: ReadonlySet<string>) => void;
  /** 选中的单里人数算不出的订单号；非空就不能发。 */
  badPax: string[];
  sendType: MorningSendType;
  onSendTypeChange: (value: MorningSendType) => void;
  onSend: () => void;
  onStartOver: () => void;
}) {
  const sendable = rows.filter((r) => !r.duplicate);
  const alreadySent = rows.filter((r) => r.duplicate);
  const partialCount = alreadySent.filter((r) => r.partial).length;

  function update(orders: readonly string[], checked: boolean) {
    const next = new Set(selected);
    for (const o of orders) {
      if (checked) next.add(o);
      else next.delete(o);
    }
    onSelectedChange(next);
  }

  function selectAll() {
    update(
      sendable.map((r) => r.order_number),
      true,
    );
  }

  /** 取消方向连「已发过」那块一起清——多清一点永远是安全的一侧。 */
  function deselectAll() {
    onSelectedChange(new Set());
  }

  return (
    <div>
      <section className={PREVIEW_CARD}>
        <div className={previewHeaderClass("blue")}>
          <h2 className="text-[13px] font-semibold text-[#185FA5]">
            🚌 Preview — {rows.length} bookings
            <span className="ml-2 text-[12px] font-normal text-[#888]">
              {fileName}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {alreadySent.length > 0 ? (
              <span className="text-[12px] font-semibold text-[#A32D2D]">
                ⚠️ {alreadySent.length} already sent today
              </span>
            ) : null}
            <span className="text-[12px] text-[#888]">
              Selected:{" "}
              <span className="font-semibold text-[#185FA5] tabular-nums">
                {selected.size}
              </span>
            </span>
            <button
              type="button"
              onClick={selectAll}
              className={cn(
                SEL_BAR_BUTTON,
                "border-[#185FA5] bg-[#185FA5] hover:bg-[#124d8a]",
              )}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className={cn(
                SEL_BAR_BUTTON,
                "border-[#BA7517] bg-[#BA7517] hover:bg-[#8f5a10]",
              )}
            >
              Deselect all
            </button>
          </div>
        </div>

        {sendable.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-[#888]">
            Everyone in this file already got today&apos;s message.
          </p>
        ) : (
          groupByLocation(sendable).map((group) => {
            const orders = group.rows.map((r) => r.order_number);
            const checked = orders.filter((o) => selected.has(o)).length;
            const total = orders.length;
            return (
              <div key={group.location}>
                <div className="flex items-center gap-2.5 border-b-[0.5px] border-black/[.06] bg-[#f0f6fd] px-3 py-2">
                  <span className="flex-1 text-[12px] font-semibold text-[#185FA5]">
                    📍 {group.location} —{" "}
                    <span className="tabular-nums">
                      {checked === total ? total : `${checked}/${total}`}
                    </span>{" "}
                    booking(s)
                  </span>
                  <button
                    type="button"
                    // 组里有勾着的就全取消，一个都没勾就全选（与旧页面一致）。
                    onClick={() => update(orders, checked === 0)}
                    className={cn(
                      "cursor-pointer rounded-[5px] border-[0.5px] bg-white px-2.5 py-[3px] text-[11px] whitespace-nowrap transition-colors duration-[120ms]",
                      checked === 0
                        ? "border-[#aaa] text-[#aaa]"
                        : "border-[#185FA5] text-[#185FA5] hover:bg-[#E6F1FB]",
                    )}
                  >
                    {checked === 0
                      ? "Select all"
                      : checked === total
                        ? "Deselect all"
                        : `${checked}/${total} selected`}
                  </button>
                </div>
                <RowsTable
                  rows={group.rows}
                  selected={selected}
                  onToggle={(order, value) => update([order], value)}
                  extraHead={["Driver", "Vehicle #"]}
                  extraCells={(r) => [r.driver || "—", r.vehicle_no || "—"]}
                />
              </div>
            );
          })
        )}
      </section>

      {alreadySent.length > 0 ? (
        <section className="mb-5 overflow-hidden rounded-xl bg-[#1A3A5C] text-[#dbe6f2]">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-white/10 bg-[#15304c] px-4 py-3">
            <h2 className="text-[13.5px] font-bold text-[#FFD4D0] tabular-nums">
              ⚠️ {alreadySent.length} already sent today
            </h2>
            <span className="text-[11.5px] text-[#9db4cc]">
              {describeAlreadySent(alreadySent)}
              {partialCount > 0
                ? ` · ${partialCount} with one channel failed`
                : ""}
            </span>
          </div>
          <p className="border-b border-white/[.08] bg-[#17334f] px-4 py-2 text-[11px] text-[#9db4cc]">
            Tick a guest here only to deliberately send a second message.
          </p>
          {groupByLocation(alreadySent).map((group) => {
            const orders = group.rows.map((r) => r.order_number);
            const checked = orders.filter((o) => selected.has(o)).length;
            const total = orders.length;
            return (
              <div key={group.location}>
                <div className="flex items-center gap-2.5 border-b border-white/[.08] bg-[#17334f] px-3 py-2">
                  <span className="flex-1 text-[12px] font-semibold text-[#b9d0e6]">
                    📍 {group.location} — {total} already sent
                  </span>
                  <button
                    type="button"
                    onClick={() => update(orders, checked === 0)}
                    className="cursor-pointer rounded-[5px] border-[0.5px] border-[#6f93b6] bg-transparent px-2.5 py-[3px] text-[11px] whitespace-nowrap text-[#cfe0ef] transition-colors duration-[120ms] hover:bg-white/[.08]"
                  >
                    {checked === 0
                      ? `Send anyway (all ${total})`
                      : checked === total
                        ? `Cancel all ${total}`
                        : `${checked}/${total} will resend`}
                  </button>
                </div>
                <RowsTable
                  dark
                  rows={group.rows}
                  selected={selected}
                  onToggle={(order, value) => update([order], value)}
                  extraHead={["Sent", ""]}
                  extraCells={(r) => [
                    <span key="at" className="text-[11px]">
                      {r.sent_at ? formatLaClock(r.sent_at) || "—" : "—"}
                    </span>,
                    <span key="sent">
                      <span className="rounded px-1.5 py-px text-[10px] font-semibold text-[#FFD4D0] [background:rgba(255,120,110,0.18)]">
                        Already sent
                      </span>
                      {r.partial ? <PartialPill partial={r.partial} /> : null}
                    </span>,
                  ]}
                />
              </div>
            );
          })}
        </section>
      ) : null}

      <div className="mb-5">
        {badPax.length > 0 ? (
          <p role="alert" className={cn(RED_BOX, "mb-3")}>
            ⚠️ Guest count not found in Quantities: {badPax.join(", ")}. Nothing
            can be sent until this is fixed. Fix the quantity in Rezdy, download
            the CSV again and upload it, or untick these guests.
          </p>
        ) : null}
        <SendTypePicker
          types={SEND_TYPES}
          value={sendType}
          onChange={onSendTypeChange}
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={selected.size === 0 || badPax.length > 0}
            onClick={onSend}
            className={sendButtonClass("blue")}
          >
            {SEND_ICON[sendType]} Send to Selected ({sendTypeShort(sendType)}) —{" "}
            {selected.size} order{selected.size === 1 ? "" : "s"}
          </button>
          <button type="button" onClick={onStartOver} className={DARK_BUTTON}>
            ↩ Start Over
          </button>
        </div>
      </div>
    </div>
  );
}

/** 一张表：上面那块（白底）或「今天已发过」那块（dark，深蓝底浅色字）。 */
function RowsTable({
  rows,
  selected,
  onToggle,
  extraHead,
  extraCells,
  dark = false,
}: {
  rows: MorningManifestRow[];
  selected: ReadonlySet<string>;
  onToggle: (order: string, value: boolean) => void;
  extraHead: [string, string];
  extraCells: (row: MorningManifestRow) => [ReactNode, ReactNode];
  dark?: boolean;
}) {
  const th = cn(
    "px-2.5 py-2 text-left text-[11px] font-semibold",
    dark
      ? "border-b border-white/[.08] bg-[#143047] text-[#8aa6bf]"
      : "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] text-[#999]",
  );
  const td = cn("px-2.5 py-2", dark ? "text-[#d3e0ed]" : "text-[#444]");
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <thead>
          <tr>
            <th className={cn(th, "w-9 text-center")}>
              <span className="sr-only">Send</span>
            </th>
            <th className={th}>Order #</th>
            <th className={th}>Name</th>
            <th className={th}>Phone</th>
            <th className={th}>Pickup Time</th>
            <th className={th}>{extraHead[0]}</th>
            <th className={th}>{extraHead[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const checked = selected.has(row.order_number);
            const [a, b] = extraCells(row);
            return (
              <tr
                key={`${row.order_number}-${i}`}
                className={cn(
                  "transition-colors duration-100 last:border-b-0",
                  dark
                    ? "border-b border-white/[.07]"
                    : "border-b-[0.5px] border-black/[.06]",
                  // .row-unchecked 只在上面那块（旧页面下面那块默认就不勾，不变灰）。
                  !dark && !checked && "bg-[#fafafa] opacity-55",
                )}
              >
                <td className={cn(td, "text-center")}>
                  <input
                    type="checkbox"
                    aria-label={`Send to ${row.order_number}`}
                    checked={checked}
                    onChange={(e) =>
                      onToggle(row.order_number, e.target.checked)
                    }
                    className={cn(
                      "h-[15px] w-[15px] cursor-pointer align-middle",
                      dark ? "accent-[#7fb3e0]" : "accent-[#185FA5]",
                    )}
                  />
                </td>
                <td className={td}>{row.order_number || "—"}</td>
                <td className={td}>{row.name}</td>
                <td className={cn(td, "text-[11px]")}>{row.phone || "—"}</td>
                <td className={td}>{row.pickup_time}</td>
                <td className={td}>{a}</td>
                <td className={td}>{b}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CHANNEL_NAME = { sms: "SMS", email: "Email" } as const;

/** 一个渠道失败、另一个发出去了：红胶囊写失败的渠道，后面写另一个渠道的状态（同旧页面）。 */
function PartialPill({ partial }: { partial: MorningPartial }) {
  const other = partial.failed === "sms" ? "email" : "sms";
  return (
    <>
      <span className="ml-1.5 rounded-full bg-[#C0392B] px-2 py-px text-[10px] font-semibold whitespace-nowrap text-white">
        {CHANNEL_NAME[partial.failed] ?? partial.failed} failed
      </span>
      <span className="ml-1 text-[11px] whitespace-nowrap text-[#b9d0e6]">
        {CHANNEL_NAME[other]} {partial.other}
      </span>
    </>
  );
}
