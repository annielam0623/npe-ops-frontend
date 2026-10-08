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
import {
  BLUE_BOX,
  DARK_BUTTON,
  DUP_BADGE,
  PREVIEW_CARD,
  previewHeaderClass,
  RED_BOX,
  SEND_ANYWAY_ALL,
  SEND_ANYWAY_LABEL,
  SEND_ICON,
  SendTypePicker,
  sendButtonClass,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
  YELLOW_BOX,
} from "./legacy-ui";

function paxOf(row: TicketsManifestRow): string {
  if (!isCsvRow(row)) return row.quantities;
  return row.pax_ok ? String(row.pax) : "?";
}

/** 旧页面 tr.removed-row td：灰字、浅灰底、划掉（说明那一格不划）。 */
const REMOVED_TD = "bg-[#fafafa] px-2.5 py-2 text-[#aaa] line-through";
const REMOVED_NOTE = "bg-[#fafafa] px-2.5 py-2 text-[#aaa]";

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
  // .xlsx 没有 Quantities 说明，整列不显示（同旧页面 no-qty-text）。
  const csv = rows.length > 0 && isCsvRow(rows[0]);
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
    <div>
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
      <section className={PREVIEW_CARD}>
        <div className={previewHeaderClass("orange")}>
          <h2 className="text-[13px] font-semibold text-[#BA7517]">
            ✅ Preview — {rows.length} bookings · {tourLabel} ·{" "}
            {batch.serviceDate}
          </h2>
          <span className="text-[12px] text-[#888]">{batch.fileName}</span>
        </div>
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>CHD#</th>
                <th className={TH}>Confirmation#</th>
                <th className={TH}>Name</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Email</th>
                <th className={TH}>Qty</th>
                {csv ? <th className={TH}>Quantities</th> : null}
                <th className={TH}>Check-in Time</th>
                <th className={TH}>Tour Time</th>
                <th className={TH}>Note</th>
                <th className={TH}>
                  {duplicateIndexes.length > 0 ? (
                    <label className={SEND_ANYWAY_ALL}>
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
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={cn(
                    TR,
                    (isCsvRow(row) && !row.pax_ok) || row.listed_twice_conflict
                      ? "bg-[#fdecec]"
                      : (row.duplicate || row.listed_twice) && "bg-[#fff8e1]",
                  )}
                >
                  <td className={TD}>{row.order_number || "—"}</td>
                  <td className={cn(TD, "text-[11px]")}>
                    {row.confirmation_no || "—"}
                  </td>
                  <td className={TD}>{row.name}</td>
                  <td className={cn(TD, "text-[11px]")}>{row.phone || "—"}</td>
                  <td className={cn(TD, "text-[11px]")}>{row.email || "—"}</td>
                  <td className={TD}>
                    {isCsvRow(row) ? (
                      <strong className={cn(!row.pax_ok && "text-[#A32D2D]")}>
                        {row.pax_ok ? row.pax : "?"}
                      </strong>
                    ) : (
                      row.quantities
                    )}
                  </td>
                  {csv ? (
                    <td className={cn(TD, "text-[11px] text-[#777]")}>
                      {isCsvRow(row) ? row.qty_label : ""}
                    </td>
                  ) : null}
                  <td className={TD}>{row.checkin_time}</td>
                  <td className={TD}>{row.tour_time}</td>
                  <td className={TD}>
                    {batch.compare && row.upload_status ? (
                      <CompareBadge kind={row.upload_status} />
                    ) : null}
                    {row.listed_twice_conflict ? (
                      <span
                        className={cn(DUP_BADGE, "bg-[#fdecec] text-[#A32D2D]")}
                      >
                        Listed twice, details differ
                      </span>
                    ) : row.listed_twice ? (
                      <span className={DUP_BADGE}>
                        Listed twice in this file
                      </span>
                    ) : null}
                    {row.duplicate && !row.listed_twice ? (
                      <span
                        title="Already sent for this day and tour"
                        className={DUP_BADGE}
                      >
                        Duplicate
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    {row.duplicate && !row.listed_twice ? (
                      <label className={SEND_ANYWAY_LABEL}>
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
                  className={TR}
                >
                  <td className={REMOVED_TD}>{r.order_number}</td>
                  <td className={REMOVED_TD} />
                  <td className={REMOVED_TD}>{r.name}</td>
                  <td className={REMOVED_TD} />
                  <td className={REMOVED_TD} />
                  <td className={REMOVED_TD}>{r.pax ?? ""}</td>
                  {csv ? <td className={REMOVED_TD} /> : null}
                  <td className={REMOVED_TD}>{r.checkin_time}</td>
                  <td className={REMOVED_TD}>{r.tour_time}</td>
                  <td className={REMOVED_NOTE} colSpan={2}>
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

      <div className="mb-5">
        {/* Check-in Time 是算出来的（Rezdy 原文件，或模板里空着的格子）：蓝条说按几分钟算的，同旧页面。 */}
        {batch.checkinNote ? (
          <p role="status" className={BLUE_BOX}>
            ℹ️ {batch.checkinNote}
          </p>
        ) : null}
        {batch.warning ? (
          <p className={YELLOW_BOX}>⚠️ {batch.warning}</p>
        ) : null}
        {blocked.length ? (
          <div role="alert" className={RED_BOX}>
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
              "mb-2.5 text-[12px]",
              skipped > 0 ? "text-[#BA7517]" : "text-[#3B6D11]",
            )}
          >
            {skipped > 0
              ? `⚠️ ${[
                  skippedDups ? `${skippedDups} already sent` : "",
                  twice ? `${twice} listed twice` : "",
                ]
                  .filter(Boolean)
                  .join(" and ")} will be skipped`
              : duplicateIndexes.length > 0
                ? "✅ All duplicates will be sent again (once)."
                : "✅ No duplicates found"}
          </p>
        )}
        <SendTypePicker
          types={SEND_TYPES}
          value={sendType}
          onChange={onSendTypeChange}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={toSend === 0 || blocked.length > 0 || sendDisabled}
            onClick={onSend}
            className={sendButtonClass("orange")}
          >
            {SEND_ICON[sendType]} Send {toSend} Reminder
            {toSend === 1 ? "" : "s"} ({sendTypeShort(sendType)})
          </button>
          <button
            type="button"
            // Apply 存的时候不能换批：存完的结果会盖回旧的预览。
            disabled={sendDisabled}
            onClick={onStartOver}
            className={DARK_BUTTON}
          >
            ↩ Start Over
          </button>
        </div>
      </div>
    </div>
  );
}
