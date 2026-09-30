import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { cn } from "@/lib/utils";
import type { MorningManifestRow, MorningSendType } from "@/types";

import {
  describeAlreadySent,
  formatLaClock,
  groupByLocation,
  SEND_TYPES,
  sendTypeShort,
} from "./config";

const TH_CLASS =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-500";
const TD_CLASS = "px-3 py-2 whitespace-nowrap";
const SMALL_BUTTON_CLASS =
  "rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap";

/**
 * 预览：没发过的按上车地点分组（默认全选）；今天已经发过的放在下面单独一块（默认一个都不勾）。
 * 🔴 Select all 和地点切换只动上面那块——2026-09-15 那次 25 单双发就是 Select all 把已发过的也勾上了。
 */
export function MorningPreviewStep({
  fileName,
  rows,
  selected,
  onSelectedChange,
  sendType,
  onSendTypeChange,
  onSend,
  onStartOver,
}: {
  fileName: string;
  rows: MorningManifestRow[];
  selected: ReadonlySet<string>;
  onSelectedChange: (value: ReadonlySet<string>) => void;
  sendType: MorningSendType;
  onSendTypeChange: (value: MorningSendType) => void;
  onSend: () => void;
  onStartOver: () => void;
}) {
  const sendable = rows.filter((r) => !r.duplicate);
  const alreadySent = rows.filter((r) => r.duplicate);

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
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-[#e6f0fb] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#185FA5]">
            Preview — {rows.length} booking{rows.length === 1 ? "" : "s"}
            <span className="ml-2 text-xs font-normal text-stone-500">
              {fileName}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {alreadySent.length > 0 ? (
              <span className="font-semibold text-[#A32D2D]">
                ⚠️ {alreadySent.length} already sent today
              </span>
            ) : null}
            <span className="text-stone-500">
              Selected:{" "}
              <b className="text-[#185FA5] tabular-nums">{selected.size}</b>
            </span>
            <button
              type="button"
              onClick={selectAll}
              className={cn(
                SMALL_BUTTON_CLASS,
                "border-[#185FA5]/40 bg-white text-[#185FA5]",
              )}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className={cn(
                SMALL_BUTTON_CLASS,
                "border-stone-300 bg-white text-stone-600",
              )}
            >
              Deselect all
            </button>
          </div>
        </div>

        {sendable.length === 0 ? (
          <p className="px-4 py-6 text-sm text-stone-500">
            Everyone in this file already got today&apos;s message.
          </p>
        ) : (
          groupByLocation(sendable).map((group) => {
            const orders = group.rows.map((r) => r.order_number);
            const checked = orders.filter((o) => selected.has(o)).length;
            const total = orders.length;
            return (
              <div
                key={group.location}
                className="border-b border-stone-100 last:border-b-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-semibold text-stone-800">
                    📍 {group.location} —{" "}
                    <span className="tabular-nums">
                      {checked === total ? total : `${checked}/${total}`}
                    </span>{" "}
                    booking{total === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    // 组里有勾着的就全取消，一个都没勾就全选（与旧页面一致）。
                    onClick={() => update(orders, checked === 0)}
                    className={cn(
                      SMALL_BUTTON_CLASS,
                      checked === 0
                        ? "border-[#185FA5] bg-[#185FA5] text-white"
                        : "border-stone-300 bg-white text-stone-600",
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
        <section className="overflow-hidden rounded-lg border border-[#1A3A5C] bg-[#1A3A5C] text-[#dbe6f2]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
            <h2 className="text-sm font-semibold">
              ⚠️ {alreadySent.length} already sent today
            </h2>
            <span className="text-xs text-[#9fb6cf]">
              {describeAlreadySent(alreadySent)}
            </span>
          </div>
          <p className="px-4 pb-2 text-xs text-[#9fb6cf]">
            Tick a guest here only to deliberately send a second message.
          </p>
          {groupByLocation(alreadySent).map((group) => {
            const orders = group.rows.map((r) => r.order_number);
            const checked = orders.filter((o) => selected.has(o)).length;
            const total = orders.length;
            return (
              <div key={group.location} className="bg-white text-stone-800">
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1A3A5C]/20 bg-[#eef3f8] px-4 py-2">
                  <span className="text-sm font-semibold">
                    📍 {group.location} — {total} already sent
                  </span>
                  <button
                    type="button"
                    onClick={() => update(orders, checked === 0)}
                    className={cn(
                      SMALL_BUTTON_CLASS,
                      "border-[#A32D2D]/40 bg-white text-[#A32D2D]",
                    )}
                  >
                    {checked === 0
                      ? `Send anyway (all ${total})`
                      : checked === total
                        ? `Cancel all ${total}`
                        : `${checked}/${total} will resend`}
                  </button>
                </div>
                <RowsTable
                  rows={group.rows}
                  selected={selected}
                  onToggle={(order, value) => update([order], value)}
                  extraHead={["Sent", ""]}
                  extraCells={(r) => [
                    r.sent_at ? formatLaClock(r.sent_at) || "—" : "—",
                    "Already sent",
                  ]}
                />
              </div>
            );
          })}
        </section>
      ) : null}

      <div className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label="Send type"
          className="flex flex-wrap gap-2"
        >
          {SEND_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={sendType === t.value}
              onClick={() => onSendTypeChange(t.value)}
              className={cn(
                "rounded-md border px-4 py-1.5 text-sm",
                sendType === t.value
                  ? "border-stone-800 bg-stone-800 font-medium text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={onSend}
            className={PRIMARY_BUTTON_CLASS}
          >
            Send to Selected ({sendTypeShort(sendType)}) — {selected.size} order
            {selected.size === 1 ? "" : "s"}
          </button>
          <button
            type="button"
            onClick={onStartOver}
            className={SECONDARY_BUTTON_CLASS}
          >
            ↩ Start Over
          </button>
        </div>
      </div>
    </div>
  );
}

function RowsTable({
  rows,
  selected,
  onToggle,
  extraHead,
  extraCells,
}: {
  rows: MorningManifestRow[];
  selected: ReadonlySet<string>;
  onToggle: (order: string, value: boolean) => void;
  extraHead: [string, string];
  extraCells: (row: MorningManifestRow) => [string, string];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-stone-100">
          <tr>
            <th className={cn(TH_CLASS, "w-8")}>
              <span className="sr-only">Send</span>
            </th>
            <th className={TH_CLASS}>Order #</th>
            <th className={TH_CLASS}>Name</th>
            <th className={TH_CLASS}>Phone</th>
            <th className={TH_CLASS}>Pickup Time</th>
            <th className={TH_CLASS}>{extraHead[0]}</th>
            <th className={TH_CLASS}>{extraHead[1]}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row, i) => {
            const checked = selected.has(row.order_number);
            const [a, b] = extraCells(row);
            return (
              <tr
                key={`${row.order_number}-${i}`}
                className={cn(!checked && "text-stone-400")}
              >
                <td className={TD_CLASS}>
                  <input
                    type="checkbox"
                    aria-label={`Send to ${row.order_number}`}
                    checked={checked}
                    onChange={(e) =>
                      onToggle(row.order_number, e.target.checked)
                    }
                  />
                </td>
                <td className={TD_CLASS}>{row.order_number || "—"}</td>
                <td className={TD_CLASS}>{row.name}</td>
                <td className={`${TD_CLASS} text-xs`}>{row.phone || "—"}</td>
                <td className={TD_CLASS}>{row.pickup_time}</td>
                <td className={`${TD_CLASS} text-xs`}>{a}</td>
                <td className={`${TD_CLASS} text-xs`}>
                  {b === "Already sent" ? (
                    <span className="rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5410]">
                      Already sent
                    </span>
                  ) : (
                    b
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
