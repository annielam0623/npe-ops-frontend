import {
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
  THEME,
  TR,
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
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

/** 旧页面 tr.removed-row td：灰字、浅灰底、划掉（说明那一格不划）。 */
const REMOVED_TD = "bg-[#fafafa] px-2.5 py-2 text-[#aaa] line-through";
const REMOVED_NOTE = "bg-[#fafafa] px-2.5 py-2 text-[#aaa]";
/** 这一页旧模板有一条全页的 .btn:hover（浅灰底深字），↩ Start Over / ✕ Cancel 悬停时也是这样。 */
const TOUR_DARK_BUTTON = DARK_BUTTON.replace(
  "hover:bg-white/[.08]",
  "hover:bg-[#ebebe8] hover:text-[#222]",
);

export function TourPreview({
  batch,
  sendAnyway,
  onSendAnywayChange,
  sendType,
  onSendTypeChange,
  onSend,
  sendDisabled = false,
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
  /** Apply 正在存时不让发（同一单两边同时写库会多出一行）。 */
  sendDisabled?: boolean;
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
          tone: "text-[#BA7517]",
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
    <div>
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

      <section aria-label={`${lane.title} preview`} className={PREVIEW_CARD}>
        <div className={previewHeaderClass(lane.theme)}>
          <h2
            className={cn("text-[13px] font-semibold", THEME[lane.theme].text)}
          >
            {batch.lane === "last_minute"
              ? "⚡ Last Minute Preview"
              : "✅ Preview"}{" "}
            — {rows.length} bookings
            {guests !== null ? ` · ${guests} guests` : ""} · {batch.tourLabel} ·{" "}
            {batch.tourDate}
          </h2>
          <span className="text-[12px] text-[#888]">{batch.fileName}</span>
        </div>
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead>
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
                    <label className={SEND_ANYWAY_ALL}>
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
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  data-order={r.order_number}
                  className={cn(
                    TR,
                    (isCsvRow(r) && !r.pax_ok) || r.listed_twice_conflict
                      ? "bg-[#fdecec]"
                      : (r.duplicate || r.listed_twice) && "bg-[#fff8e1]",
                  )}
                >
                  <td className={TD}>{r.order_number || "—"}</td>
                  <td className={TD}>{r.name}</td>
                  <td className={cn(TD, "text-[11px]")}>
                    {r.email || <span className="text-[#ccc]">—</span>}
                  </td>
                  <td className={cn(TD, "text-[11px]")}>
                    {r.phone || <span className="text-[#ccc]">—</span>}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "font-bold",
                      isCsvRow(r) && !r.pax_ok && "text-[#A32D2D]",
                    )}
                  >
                    {paxText(r)}
                  </td>
                  {csv ? (
                    <td className={cn(TD, "text-[11px] text-[#777]")}>
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
                      <span className="font-normal text-[#ccc]">—</span>
                    )}
                  </td>
                  <td className={TD}>{r.pickup_time}</td>
                  <td className={TD}>{r.pickup_location}</td>
                  <td className={TD}>
                    {batch.compare && r.upload_status ? (
                      <CompareBadge kind={r.upload_status} />
                    ) : null}
                    {r.listed_twice_conflict ? (
                      <span
                        className={cn(DUP_BADGE, "bg-[#fdecec] text-[#A32D2D]")}
                      >
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
                  <td className={REMOVED_TD}>{r.name}</td>
                  <td className={REMOVED_TD} />
                  <td className={REMOVED_TD} />
                  <td className={REMOVED_TD}>{r.pax ?? ""}</td>
                  {csv ? <td className={REMOVED_TD} /> : null}
                  <td className={REMOVED_TD} />
                  <td className={REMOVED_TD}>{r.pickup_time}</td>
                  <td className={REMOVED_TD}>{r.pickup_location}</td>
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
        {blocked.length ? (
          <div role="alert" className={RED_BOX}>
            <p className="font-semibold">
              ⛔ Nothing can be sent until this is fixed.
            </p>
            {blocked.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </div>
        ) : null}
        {batch.warning || noEmail.length || noPhone.length ? (
          <div data-testid="missing-info" className={YELLOW_BOX}>
            {batch.warning ? <p>⚠️ {batch.warning}</p> : null}
            {noEmail.length || noPhone.length ? (
              <p>⚠️ Some bookings have missing information:</p>
            ) : null}
            {noEmail.length ? (
              <p className="pl-2">
                • <strong>No email</strong> (email will be skipped):{" "}
                {noEmail.join(", ")}
              </p>
            ) : null}
            {noPhone.length ? (
              <p className="pl-2">
                • <strong>No phone</strong> (SMS will be skipped):{" "}
                {noPhone.join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className={cn("mb-2 text-[12px]", meta.tone)}>{meta.text}</p>
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
            className={sendButtonClass(lane.theme)}
          >
            {/* 旧页面 Last Minute 默认是 ⚡，换了方式才是方式的图标。 */}
            {batch.lane === "last_minute" && sendType === "combined"
              ? "⚡"
              : SEND_ICON[sendType]}{" "}
            {lane.sendLabel} — {toSend} order{toSend === 1 ? "" : "s"} (
            {sendTypeShort(sendType)})
          </button>
          <button
            type="button"
            // Apply 存的时候不能换批：存完的结果会盖回旧的预览。
            disabled={sendDisabled}
            onClick={onCancel}
            className={TOUR_DARK_BUTTON}
          >
            {batch.lane === "last_minute" ? "✕ Cancel" : "↩ Start Over"}
          </button>
        </div>
      </div>
    </div>
  );
}
