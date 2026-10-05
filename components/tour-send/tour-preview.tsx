import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import {
  type ApplyState,
  CompareBadge,
  UploadComparePanel,
} from "@/components/ui/upload-compare-panel";
import { cn } from "@/lib/utils";
import type {
  TourLane,
  TourManifestRow,
  TourRemovedOrder,
  TourSendType,
} from "@/types";

import {
  blockReasons,
  isCsvRow,
  LANES,
  mtlvLabel,
  paxText,
  SEND_TYPES,
  sendTypeShort,
} from "./config";

export interface TourBatch {
  lane: TourLane;
  tourType: string;
  tourLabel: string;
  tourDate: string;
  fileName: string;
  rows: TourManifestRow[];
  /** 预览时的服务器时间，发送时原样带回（Send anyway 只对这之前发过的单生效）。 */
  previewAt: string;
  conflicts: string[];
  warning: string;
  /** 这个团期（这一块）已有订单时才有：比对结果。 */
  compare: { removed: TourRemovedOrder[] } | null;
}

const TH =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-500";
const TD = "px-3 py-2 whitespace-nowrap";
const DUP_BADGE =
  "mr-1 rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-[#8a5410]";

export function TourPreview({
  batch,
  sendAnyway,
  onSendAnywayChange,
  sendType,
  onSendTypeChange,
  onSend,
  onCancel,
  apply,
  onApply,
}: {
  batch: TourBatch;
  sendAnyway: ReadonlySet<number>;
  onSendAnywayChange: (value: ReadonlySet<number>) => void;
  sendType: TourSendType;
  onSendTypeChange: (value: TourSendType) => void;
  onSend: () => void;
  onCancel: () => void;
  apply: ApplyState;
  onApply: () => void;
}) {
  const { rows } = batch;
  const lane = LANES[batch.lane];
  const csv = rows.length > 0 && isCsvRow(rows[0]);
  // 文件里第二次出现的同一单不发，也不给 Send anyway（客人只收一条）。
  const dupIdx = rows.flatMap((r, i) =>
    r.duplicate && !r.listed_twice ? [i] : [],
  );
  const twice = rows.filter((r) => r.listed_twice).length;
  const skippedDups = dupIdx.filter((i) => !sendAnyway.has(i)).length;
  const toSend = rows.length - skippedDups - twice;
  const blocked = blockReasons(rows, batch.conflicts);
  const allDups = dupIdx.length > 0 && dupIdx.every((i) => sendAnyway.has(i));
  const guests = csv ? rows.reduce((s, r) => s + (r.pax || 0), 0) : null;
  const noEmail = rows.filter((r) => !r.email).map((r) => r.order_number);
  const noPhone = rows.filter((r) => !r.phone).map((r) => r.order_number);
  const dups = rows.filter((r) => r.duplicate).length;
  const meta = blocked.length
    ? {
        tone: "text-[#A32D2D]",
        text: "⛔ Fix the problems in the red box before sending",
      }
    : dups > 0
      ? {
          tone: "text-[#8a5410]",
          text: `⚠️ ${dups} previously sent order${dups === 1 ? "" : "s"} will be skipped unless you tick Send anyway`,
        }
      : {
          tone: "text-[#3B6D11]",
          text: "✅ All orders are ready for processing",
        };

  function toggle(i: number, on: boolean) {
    const next = new Set(sendAnyway);
    if (on) next.add(i);
    else next.delete(i);
    onSendAnywayChange(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {batch.compare ? (
        <UploadComparePanel
          rows={rows}
          removed={batch.compare.removed}
          rowDetail={(r) =>
            `${paxText(r)} pax · ${r.pickup_location} ${r.pickup_time}`
          }
          removedDetail={(r) =>
            `${r.pax ?? "—"} pax · ${r.pickup_location} ${r.pickup_time}`
          }
          apply={apply}
          applyBlocked={blocked.length > 0}
          onApply={onApply}
        />
      ) : null}

      <section
        aria-label={`${lane.title} preview`}
        className="overflow-hidden rounded-lg border border-stone-200 bg-white"
      >
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3",
            lane.headBg,
          )}
        >
          <h2 className={cn("text-sm font-semibold", lane.headText)}>
            {batch.lane === "last_minute"
              ? "⚡ Last Minute Preview"
              : "✅ Preview"}{" "}
            — {rows.length} booking{rows.length === 1 ? "" : "s"}
            {guests !== null ? ` · ${guests} guests` : ""} · {batch.tourLabel} ·{" "}
            {batch.tourDate}
          </h2>
          <span className="text-xs text-stone-500">{batch.fileName}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className={TH}>Order #</th>
                <th className={TH}>Name</th>
                <th className={TH}>Email</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Qty</th>
                {csv ? <th className={TH}>Quantities</th> : null}
                <th className={TH}>MTLV</th>
                <th className={TH}>Pickup Time</th>
                <th className={TH}>Pickup Location</th>
                <th className={TH}>Note</th>
                <th className={TH}>
                  {dupIdx.length > 0 ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[#8a5410]">
                      <input
                        type="checkbox"
                        checked={allDups}
                        onChange={(e) =>
                          onSendAnywayChange(
                            e.target.checked ? new Set(dupIdx) : new Set(),
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
              {rows.map((r, i) => (
                <tr
                  key={i}
                  data-order={r.order_number}
                  className={cn(
                    (r.duplicate || r.listed_twice) && "bg-[#fff8e1]",
                    ((isCsvRow(r) && !r.pax_ok) || r.listed_twice_conflict) &&
                      "bg-[#fdecec]",
                  )}
                >
                  <td className={TD}>{r.order_number || "—"}</td>
                  <td className={TD}>{r.name}</td>
                  <td className={cn(TD, "text-xs")}>
                    {r.email || <span className="text-stone-300">—</span>}
                  </td>
                  <td className={cn(TD, "text-xs")}>
                    {r.phone || <span className="text-stone-300">—</span>}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "font-semibold",
                      isCsvRow(r) && !r.pax_ok && "text-[#A32D2D]",
                    )}
                  >
                    {paxText(r)}
                  </td>
                  {csv ? (
                    <td className={cn(TD, "text-[11px] text-stone-500")}>
                      {r.qty_label}
                    </td>
                  ) : null}
                  <td
                    className={cn(
                      TD,
                      "text-center text-[11px] font-semibold text-[#2F7851]",
                    )}
                  >
                    {mtlvLabel(r.mtlv_promo) || (
                      <span className="font-normal text-stone-300">—</span>
                    )}
                  </td>
                  <td className={TD}>{r.pickup_time}</td>
                  <td className={TD}>{r.pickup_location}</td>
                  <td className={TD}>
                    {batch.compare && r.upload_status ? (
                      <CompareBadge kind={r.upload_status} />
                    ) : null}
                    {r.listed_twice_conflict ? (
                      <span className="mr-1 rounded-md bg-[#fdecec] px-1.5 py-0.5 text-[10px] font-medium text-[#A32D2D]">
                        Listed twice, details differ
                      </span>
                    ) : r.listed_twice ? (
                      <span className={DUP_BADGE}>
                        Listed twice in this file
                      </span>
                    ) : null}
                    {r.duplicate ? (
                      <span className={DUP_BADGE}>
                        {r.sent_label || "Already sent"}
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    {r.duplicate && !r.listed_twice ? (
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
                  <td className={cn(TD, "line-through")}>{r.order_number}</td>
                  <td className={cn(TD, "line-through")}>{r.name}</td>
                  <td className={TD} />
                  <td className={TD} />
                  <td className={cn(TD, "line-through")}>{r.pax ?? ""}</td>
                  {csv ? <td className={TD} /> : null}
                  <td className={TD} />
                  <td className={cn(TD, "line-through")}>{r.pickup_time}</td>
                  <td className={cn(TD, "line-through")}>
                    {r.pickup_location}
                  </td>
                  <td className={TD} colSpan={2}>
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
        ) : null}
        {batch.warning || noEmail.length || noPhone.length ? (
          <div
            data-testid="missing-info"
            className="flex flex-col gap-0.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
          >
            {batch.warning ? <p>⚠️ {batch.warning}</p> : null}
            {noEmail.length || noPhone.length ? (
              <p>⚠️ Some bookings have missing information:</p>
            ) : null}
            {noEmail.length ? (
              <p className="pl-4">
                • No email (email will be skipped): {noEmail.join(", ")}
              </p>
            ) : null}
            {noPhone.length ? (
              <p className="pl-4">
                • No phone (SMS will be skipped): {noPhone.join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className={cn("text-sm", meta.tone)}>{meta.text}</p>
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
            disabled={toSend === 0 || blocked.length > 0}
            onClick={onSend}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50",
              lane.accent,
              lane.accentHover,
            )}
          >
            {lane.sendLabel} — {toSend} order{toSend === 1 ? "" : "s"} (
            {sendTypeShort(sendType)})
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={SECONDARY_BUTTON_CLASS}
          >
            {batch.lane === "last_minute" ? "✕ Cancel" : "↩ Start Over"}
          </button>
        </div>
      </div>
    </div>
  );
}
