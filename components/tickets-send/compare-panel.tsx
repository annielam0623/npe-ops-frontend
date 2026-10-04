import { cn } from "@/lib/utils";
import type { TicketsManifestRow, TicketsRemovedOrder } from "@/types";

import { isCsvRow } from "./config";

export const COMPARE_BADGE = {
  added: { label: "Added", className: "bg-[#EAF3DE] text-[#2F7851]" },
  changed: { label: "Changed", className: "bg-[#E6F1FB] text-[#185FA5]" },
  unchanged: { label: "No change", className: "bg-stone-100 text-stone-500" },
  removed: { label: "Removed", className: "bg-[#fdeceb] text-[#b3261e]" },
} as const;

export function CompareBadge({ kind }: { kind: keyof typeof COMPARE_BADGE }) {
  const b = COMPARE_BADGE[kind];
  return (
    <span
      className={cn(
        "mr-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        b.className,
      )}
    >
      {b.label}
    </span>
  );
}

function paxOf(row: TicketsManifestRow): string {
  if (!isCsvRow(row)) return row.quantities;
  return row.pax_ok ? String(row.pax) : "?";
}

export type ApplyState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "saved"; message: string };

/**
 * 这个团期已有订单时（重新上传）：Added / Removed / Changed，点 Apply 把 Added、Changed 存进系统。
 * Apply 不发任何消息；Removed 只标出来，不发消息（Annie 2026-10-03，同旧页面）。
 */
export function ComparePanel({
  rows,
  removed,
  apply,
  applyBlocked,
  onApply,
}: {
  rows: TicketsManifestRow[];
  removed: TicketsRemovedOrder[];
  apply: ApplyState;
  /** 整批不能发的原因还在（人数算不出等），也不能 Apply。 */
  applyBlocked: boolean;
  onApply: () => void;
}) {
  const added = rows.filter((r) => r.upload_status === "added");
  const changed = rows.filter((r) => r.upload_status === "changed");
  const unchanged = rows.filter((r) => r.upload_status === "unchanged").length;
  const nApply = added.length + changed.length;

  return (
    <section
      aria-label="Changes since the last upload"
      className="overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <div className="flex flex-wrap justify-between gap-2 bg-[#E6F1FB] px-4 py-2.5 text-sm font-semibold text-[#185FA5]">
        <span>This tour and date already have orders in the system</span>
        <span className="text-xs font-normal text-stone-600">
          {added.length} added · {removed.length} removed · {changed.length}{" "}
          changed · {unchanged} unchanged
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-3 text-[13px] text-stone-700">
        {added.map((r) => (
          <Row key={`a${r.order_number}`}>
            <CompareBadge kind="added" />
            <span className="font-mono text-xs">{r.order_number}</span> {r.name}{" "}
            · {paxOf(r)} pax · check-in {r.checkin_time}
          </Row>
        ))}
        {removed.map((r) => (
          <Row key={`r${r.order_number}`}>
            <CompareBadge kind="removed" />
            <span className="font-mono text-xs">{r.order_number}</span> {r.name}{" "}
            · {r.pax ?? "—"} pax · check-in {r.checkin_time}
            <span className="ml-auto text-xs text-stone-500">
              Not in the new file. Kept in the list, marked Removed. No message
              is sent to the guest.
            </span>
          </Row>
        ))}
        {changed.map((r) => (
          <Row key={`c${r.order_number}`} className="bg-[#f3f8fe]">
            <CompareBadge kind="changed" />
            <span className="font-mono text-xs">{r.order_number}</span> {r.name}{" "}
            ·{" "}
            {(r.changes ?? []).map((c, i) => (
              <span key={i} className="mr-2">
                <span className="text-stone-500">{c.col}</span>{" "}
                <span className="text-[#a33] line-through">
                  {c.old || "(blank)"}
                </span>{" "}
                →{" "}
                <span className="font-semibold text-[#2F7851]">
                  {c.new || "(blank)"}
                </span>
              </span>
            ))}
            {r.duplicate ? (
              <span className="ml-auto rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5410]">
                Already sent
              </span>
            ) : null}
          </Row>
        ))}
        {unchanged > 0 ? (
          <p className="text-xs text-stone-500">
            {unchanged} unchanged order{unchanged === 1 ? " is" : "s are"} not
            listed here.
          </p>
        ) : null}
        {nApply > 0 ? (
          <>
            <p className="text-xs text-stone-500">
              Apply saves the new values for the added and changed orders. It
              does not send anything. To send a changed order again, tick Send
              anyway on that order in the list below.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {apply.kind === "error" ? (
                <span role="alert" className="text-xs text-[#A32D2D]">
                  {apply.message}
                </span>
              ) : apply.kind === "saving" ? (
                <span className="text-xs text-stone-500">Saving…</span>
              ) : applyBlocked ? (
                <span className="text-xs text-[#A32D2D]">
                  Fix the problems below first.
                </span>
              ) : null}
              <button
                type="button"
                disabled={apply.kind === "saving" || applyBlocked}
                onClick={onApply}
                className="rounded-md bg-[#185FA5] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#134c85] disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                Apply {nApply} change{nApply === 1 ? "" : "s"}
              </button>
            </div>
          </>
        ) : (
          <p role="status" className="text-xs text-[#2F7851]">
            {apply.kind === "saved"
              ? apply.message
              : "Nothing to apply. The orders in this file match the system."}
          </p>
        )}
      </div>
    </section>
  );
}

function Row({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-1 gap-y-1 rounded-md border border-stone-200 px-2.5 py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
