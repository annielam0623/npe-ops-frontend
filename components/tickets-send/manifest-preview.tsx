import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import {
  type ApplyState,
  CompareBadge,
  UploadComparePanel,
} from "@/components/ui/upload-compare-panel";
import { cn } from "@/lib/utils";
import type {
  TicketsManifestRow,
  TicketsRemovedOrder,
  TicketsSendType,
} from "@/types";

import { blockReasons, isCsvRow, SEND_TYPES, sendTypeShort } from "./config";

function paxOf(row: TicketsManifestRow): string {
  if (!isCsvRow(row)) return row.quantities;
  return row.pax_ok ? String(row.pax) : "?";
}

const TH_CLASS =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-500";
const TD_CLASS = "px-3 py-2 whitespace-nowrap";

export function ManifestPreview({
  batch,
  tourLabel,
  sendAnyway,
  onSendAnywayChange,
  sendType,
  onSendTypeChange,
  onSend,
  sendDisabled = false,
  onStartOver,
  apply,
  onApply,
}: {
  batch: {
    serviceDate: string;
    fileName: string;
    rows: TicketsManifestRow[];
    conflicts: string[];
    warning: string;
    checkinNote: string;
    compare: { removed: TicketsRemovedOrder[] } | null;
  };
  tourLabel: string;
  sendAnyway: ReadonlySet<number>;
  onSendAnywayChange: (value: ReadonlySet<number>) => void;
  sendType: TicketsSendType;
  onSendTypeChange: (value: TicketsSendType) => void;
  onSend: () => void;
  /** Apply 正在存时不让发。 */
  sendDisabled?: boolean;
  onStartOver: () => void;
  apply: ApplyState;
  onApply: () => void;
}) {
  const { rows } = batch;
  // 文件里第二次出现的同一单不发，也不给 Send anyway（客人只收一条）。
  const duplicateIndexes = rows.flatMap((r, i) =>
    r.duplicate && !r.listed_twice ? [i] : [],
  );
  const twice = rows.filter((r) => r.listed_twice).length;
  const skippedDups = duplicateIndexes.filter((i) => !sendAnyway.has(i)).length;
  const skipped = skippedDups + twice;
  const toSend = rows.length - skipped;
  const blocked = blockReasons(rows, batch.conflicts);
  const allDupsChecked =
    duplicateIndexes.length > 0 &&
    duplicateIndexes.every((i) => sendAnyway.has(i));

  function toggle(index: number, checked: boolean) {
    const next = new Set(sendAnyway);
    if (checked) next.add(index);
    else next.delete(index);
    onSendAnywayChange(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {batch.compare ? (
        <UploadComparePanel
          rows={rows}
          removed={batch.compare.removed}
          rowDetail={(r) => `${paxOf(r)} pax · check-in ${r.checkin_time}`}
          removedDetail={(r) =>
            `${r.pax ?? "—"} pax · check-in ${r.checkin_time}`
          }
          apply={apply}
          applyBlocked={blocked.length > 0}
          onApply={onApply}
        />
      ) : null}
      <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-[#FAEEDA] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#8a5410]">
            Preview — {rows.length} booking{rows.length === 1 ? "" : "s"} ·{" "}
            {tourLabel} · {batch.serviceDate}
          </h2>
          <span className="text-xs text-stone-500">{batch.fileName}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={TH_CLASS}>CHD#</th>
                <th className={TH_CLASS}>Confirmation#</th>
                <th className={TH_CLASS}>Name</th>
                <th className={TH_CLASS}>Phone</th>
                <th className={TH_CLASS}>Email</th>
                <th className={TH_CLASS}>Qty</th>
                <th className={TH_CLASS}>Check-in Time</th>
                <th className={TH_CLASS}>Tour Time</th>
                <th className={TH_CLASS}>Note</th>
                <th className={TH_CLASS}>
                  {duplicateIndexes.length > 0 ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[#8a5410]">
                      <input
                        type="checkbox"
                        checked={allDupsChecked}
                        onChange={(e) =>
                          onSendAnywayChange(
                            e.target.checked
                              ? new Set(duplicateIndexes)
                              : new Set(),
                          )
                        }
                      />
                      Send anyway (all)
                    </label>
                  ) : null}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={cn(
                    (row.duplicate || row.listed_twice) && "bg-[#fff8e1]",
                    ((isCsvRow(row) && !row.pax_ok) ||
                      row.listed_twice_conflict) &&
                      "bg-[#fdecec]",
                  )}
                >
                  <td className={TD_CLASS}>{row.order_number || "—"}</td>
                  <td className={`${TD_CLASS} text-xs`}>
                    {row.confirmation_no || "—"}
                  </td>
                  <td className={TD_CLASS}>{row.name}</td>
                  <td className={`${TD_CLASS} text-xs`}>{row.phone || "—"}</td>
                  <td className={`${TD_CLASS} text-xs`}>{row.email || "—"}</td>
                  <td className={TD_CLASS}>
                    {isCsvRow(row) ? (
                      <span className="flex flex-col">
                        <span
                          className={cn(
                            "font-medium",
                            !row.pax_ok && "text-[#A32D2D]",
                          )}
                        >
                          {row.pax_ok ? row.pax : "?"}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {row.qty_label}
                        </span>
                      </span>
                    ) : (
                      row.quantities
                    )}
                  </td>
                  <td className={TD_CLASS}>{row.checkin_time}</td>
                  <td className={TD_CLASS}>{row.tour_time}</td>
                  <td className={TD_CLASS}>
                    {batch.compare && row.upload_status ? (
                      <CompareBadge kind={row.upload_status} />
                    ) : null}
                    {row.listed_twice_conflict ? (
                      <span className="mr-1 rounded-md bg-[#fdecec] px-1.5 py-0.5 text-[10px] font-medium text-[#A32D2D]">
                        Listed twice, details differ
                      </span>
                    ) : row.listed_twice ? (
                      <span className="mr-1 rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5410]">
                        Listed twice in this file
                      </span>
                    ) : null}
                    {row.duplicate && !row.listed_twice ? (
                      <span
                        title="Already sent for this day and tour"
                        className="rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5410]"
                      >
                        Duplicate
                      </span>
                    ) : null}
                  </td>
                  <td className={TD_CLASS}>
                    {row.duplicate && !row.listed_twice ? (
                      <label className="flex cursor-pointer items-center gap-1 text-xs text-[#8a5410]">
                        <input
                          type="checkbox"
                          checked={sendAnyway.has(i)}
                          onChange={(e) => toggle(i, e.target.checked)}
                        />
                        Send anyway
                      </label>
                    ) : null}
                  </td>
                </tr>
              ))}
              {/* Removed：系统里有、这次文件里没有。不在发送名单里，永远不会被发送。 */}
              {batch.compare?.removed.map((r) => (
                <tr
                  key={`removed-${r.order_number}`}
                  data-removed
                  className="bg-stone-50 text-stone-400"
                >
                  <td className={cn(TD_CLASS, "line-through")}>
                    {r.order_number}
                  </td>
                  <td className={TD_CLASS} />
                  <td className={cn(TD_CLASS, "line-through")}>{r.name}</td>
                  <td className={TD_CLASS} />
                  <td className={TD_CLASS} />
                  <td className={cn(TD_CLASS, "line-through")}>
                    {r.pax ?? ""}
                  </td>
                  <td className={cn(TD_CLASS, "line-through")}>
                    {r.checkin_time}
                  </td>
                  <td className={cn(TD_CLASS, "line-through")}>
                    {r.tour_time}
                  </td>
                  <td className={TD_CLASS} colSpan={2}>
                    <CompareBadge kind="removed" />
                    <span className="text-[11px]">
                      Not in the new file. No message is sent.
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        {/* Check-in Time 是算出来的（Rezdy 原文件，或模板里空着的格子）：蓝条说按几分钟算的，同旧页面。 */}
        {batch.checkinNote ? (
          <p
            role="status"
            className="rounded-md border border-[#b9d2f3] bg-[#eaf2fd] px-3 py-2 text-sm text-[#1f4f8a]"
          >
            ℹ️ {batch.checkinNote}
          </p>
        ) : null}
        {batch.warning ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⚠️ {batch.warning}
          </p>
        ) : null}
        {blocked.length ? (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-md border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-3 text-sm text-[#A32D2D]"
          >
            <p className="font-semibold">
              ⛔ Nothing can be sent until this is fixed.
            </p>
            {blocked.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </div>
        ) : (
          <p
            className={cn(
              "text-sm",
              skipped > 0 ? "text-[#8a5410]" : "text-[#3B6D11]",
            )}
          >
            {skipped > 0
              ? `${[
                  skippedDups ? `${skippedDups} already sent` : "",
                  twice ? `${twice} listed twice` : "",
                ]
                  .filter(Boolean)
                  .join(" and ")} will be skipped.`
              : duplicateIndexes.length > 0
                ? "All duplicates will be sent again (once)."
                : "No duplicates found."}
          </p>
        )}
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
            disabled={toSend === 0 || blocked.length > 0 || sendDisabled}
            onClick={onSend}
            className={PRIMARY_BUTTON_CLASS}
          >
            Send {toSend} Reminder{toSend === 1 ? "" : "s"} (
            {sendTypeShort(sendType)})
          </button>
          <button
            type="button"
            // Apply 存的时候不能换批：存完的结果会盖回旧的预览。
            disabled={sendDisabled}
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
