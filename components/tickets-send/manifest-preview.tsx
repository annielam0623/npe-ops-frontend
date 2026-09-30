import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { cn } from "@/lib/utils";
import type { TicketsManifestRow, TicketsSendType } from "@/types";

import { SEND_TYPES, sendTypeShort } from "./config";

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
  onStartOver,
}: {
  batch: { serviceDate: string; fileName: string; rows: TicketsManifestRow[] };
  tourLabel: string;
  sendAnyway: ReadonlySet<number>;
  onSendAnywayChange: (value: ReadonlySet<number>) => void;
  sendType: TicketsSendType;
  onSendTypeChange: (value: TicketsSendType) => void;
  onSend: () => void;
  onStartOver: () => void;
}) {
  const { rows } = batch;
  const duplicateIndexes = rows.flatMap((r, i) => (r.duplicate ? [i] : []));
  const skipped = duplicateIndexes.filter((i) => !sendAnyway.has(i)).length;
  const toSend = rows.length - skipped;
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
                <tr key={i} className={cn(row.duplicate && "bg-[#fff8e1]")}>
                  <td className={TD_CLASS}>{row.order_number || "—"}</td>
                  <td className={`${TD_CLASS} text-xs`}>
                    {row.confirmation_no || "—"}
                  </td>
                  <td className={TD_CLASS}>{row.name}</td>
                  <td className={`${TD_CLASS} text-xs`}>{row.phone || "—"}</td>
                  <td className={`${TD_CLASS} text-xs`}>{row.email || "—"}</td>
                  <td className={TD_CLASS}>{row.quantities}</td>
                  <td className={TD_CLASS}>{row.checkin_time}</td>
                  <td className={TD_CLASS}>{row.tour_time}</td>
                  <td className={TD_CLASS}>
                    {row.duplicate ? (
                      <span
                        title="Already sent for this day and tour"
                        className="rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5410]"
                      >
                        Duplicate
                      </span>
                    ) : null}
                  </td>
                  <td className={TD_CLASS}>
                    {row.duplicate ? (
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
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <p
          className={cn(
            "text-sm",
            skipped > 0 ? "text-[#8a5410]" : "text-[#3B6D11]",
          )}
        >
          {duplicateIndexes.length === 0
            ? "No duplicates found."
            : skipped > 0
              ? `${skipped} duplicate${skipped === 1 ? "" : "s"} will be skipped.`
              : "All duplicates will be sent again."}
        </p>
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
            disabled={toSend === 0}
            onClick={onSend}
            className={PRIMARY_BUTTON_CLASS}
          >
            Send {toSend} Reminder{toSend === 1 ? "" : "s"} (
            {sendTypeShort(sendType)})
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
