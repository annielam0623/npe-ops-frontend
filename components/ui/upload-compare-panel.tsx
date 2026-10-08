import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const COMPARE_BADGE = {
  added: { label: "Added", className: "bg-[#EAF3DE] text-[#2F7851]" },
  changed: { label: "Changed", className: "bg-[#E6F1FB] text-[#185FA5]" },
  unchanged: { label: "No change", className: "bg-[#eee] text-[#888]" },
  removed: { label: "Removed", className: "bg-[#fdeceb] text-[#b3261e]" },
} as const;

export function CompareBadge({ kind }: { kind: keyof typeof COMPARE_BADGE }) {
  const b = COMPARE_BADGE[kind];
  return (
    <span
      className={cn(
        "mr-1 rounded-md px-[7px] py-0.5 text-[10px] font-semibold whitespace-nowrap",
        b.className,
      )}
    >
      {b.label}
    </span>
  );
}

export type ApplyState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "saved"; message: string };

/** 预览里一行在比对上要用到的字段（门票、巴士团都有）。 */
export interface CompareRow {
  order_number: string;
  name: string;
  duplicate?: boolean;
  upload_status?: "added" | "changed" | "unchanged";
  changes?: { col: string; old: string; new: string }[];
}

/**
 * 发送页重新上传（这个团期已有订单）时：Added / Removed / Changed，点 Apply 把 Added、Changed 存进系统。
 * Apply 不发任何消息；Removed 只标出来，不发消息（Annie 2026-10-03，同旧页面）。
 * 门票页和巴士团发送页共用；每行后面的说明（人数、时间、地点）由页面给。
 */
export function UploadComparePanel<
  R extends CompareRow,
  X extends { order_number: string; name: string },
>({
  rows,
  removed,
  rowDetail,
  removedDetail,
  apply,
  applyBlocked,
  onApply,
}: {
  rows: R[];
  removed: X[];
  /** Added 行名字后面的说明，例 "2 pax · check-in 7:00"。 */
  rowDetail: (row: R) => ReactNode;
  removedDetail: (row: X) => ReactNode;
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
      className="mb-4 overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white"
    >
      <div className="flex flex-wrap justify-between gap-1.5 bg-[#E6F1FB] px-4 py-2.5 text-[13px] font-semibold text-[#185FA5]">
        <span>This tour and date already have orders in the system</span>
        <span className="text-[12px] font-normal text-[#666]">
          {added.length} added · {removed.length} removed · {changed.length}{" "}
          changed · {unchanged} unchanged
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-3 text-[12.5px] text-[#333]">
        {added.map((r) => (
          <Row key={`a${r.order_number}`}>
            <CompareBadge kind="added" />
            <span className={MONO}>{r.order_number}</span> {r.name} ·{" "}
            {rowDetail(r)}
          </Row>
        ))}
        {removed.map((r) => (
          <Row key={`r${r.order_number}`}>
            <CompareBadge kind="removed" />
            <span className={MONO}>{r.order_number}</span> {r.name} ·{" "}
            {removedDetail(r)}
            <span className="flex-1" />
            <span className={NOTE}>
              Not in the new file. Kept in the list, marked Removed. No message
              is sent to the guest.
            </span>
          </Row>
        ))}
        {changed.map((r) => (
          <Row key={`c${r.order_number}`} className="bg-[#f3f8fe]">
            <CompareBadge kind="changed" />
            <span className={MONO}>{r.order_number}</span> {r.name} ·{" "}
            {(r.changes ?? []).map((c, i) => (
              <span key={i}>
                {i > 0 ? " · " : null}
                <span className="text-[#777]">{c.col}</span>{" "}
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
              <>
                <span className="flex-1" />
                <span className="rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] text-[#BA7517]">
                  Already sent
                </span>
              </>
            ) : null}
          </Row>
        ))}
        {unchanged > 0 ? (
          <p className={NOTE}>
            {unchanged} unchanged order{unchanged === 1 ? " is" : "s are"} not
            listed here.
          </p>
        ) : null}
        {nApply > 0 ? (
          <>
            <p className={NOTE}>
              Apply saves the new values for the added and changed orders. It
              does not send anything. To send a changed order again, tick Send
              anyway on that order in the list below.
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2.5">
              {apply.kind === "error" ? (
                <span role="alert" className="text-[11.5px] text-[#A32D2D]">
                  {apply.message}
                </span>
              ) : apply.kind === "saving" ? (
                <span className={NOTE}>Saving…</span>
              ) : applyBlocked ? (
                <span className="text-[11.5px] text-[#A32D2D]">
                  Fix the problems below first.
                </span>
              ) : null}
              <button
                type="button"
                disabled={apply.kind === "saving" || applyBlocked}
                onClick={onApply}
                className="cursor-pointer rounded-[7px] border-none bg-[#185FA5] px-4 py-[7px] text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#aaa]"
              >
                Apply {nApply} change{nApply === 1 ? "" : "s"}
              </button>
            </div>
          </>
        ) : (
          <p role="status" className="text-[11.5px] text-[#2F7851]">
            {apply.kind === "saved"
              ? apply.message
              : "Nothing to apply. The orders in this file match the system."}
          </p>
        )}
      </div>
    </section>
  );
}

const MONO = "font-mono text-[12px]";
const NOTE = "text-[11.5px] text-[#888]";

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
        "flex flex-wrap items-center gap-2 rounded-lg border border-black/10 px-2.5 py-[7px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
