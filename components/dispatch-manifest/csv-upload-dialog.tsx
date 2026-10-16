"use client";

import { useId, useState } from "react";

import { BTN_BLUE } from "@/components/dispatch/legacy-styles";
import { Modal } from "@/components/ui/modal";
import type { UploadDiff, UploadDiffGuest } from "@/lib/dispatch-manifest-api";
import { cn } from "@/lib/utils";

const KIND = {
  added: { label: "Added", cls: "text-[#1e6b43]" },
  removed: { label: "Removed", cls: "text-[#b3261e]" },
  changed: { label: "Changed", cls: "text-[#1d4ed8]" },
} as const;

/**
 * 上传 Rezdy CSV 的比对弹窗（照旧页面 _tour_manifests_panel.html 的 `.tm-diff`）：
 * 一张表列出 Added / Removed / Changed，点 Apply 文件才再传一次、替换名单；Cancel / Esc / 点背景 = 什么都不改。
 * Added 这些是普通彩色字（ops 规矩：状态不做胶囊）。客人内容一律当普通文字渲染。
 */
export function CsvUploadDialog({
  tourTitle,
  fileName,
  diff,
  onApply,
  onCancel,
}: {
  tourTitle: string;
  fileName: string;
  diff: UploadDiff;
  /** 出错时抛 Error（message 是给 staff 看的原话），弹窗留着、写原因。 */
  onApply: () => Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = diff.added.length + diff.removed.length + diff.changed.length;
  const rows: { kind: keyof typeof KIND; g: UploadDiffGuest; note: string }[] =
    [
      ...diff.added.map((g) => ({ kind: "added" as const, g, note: "" })),
      ...diff.removed.map((g) => ({
        kind: "removed" as const,
        g,
        note: [
          g.note,
          g.bus_label ? `Was on Bus ${g.bus_label}` : "",
          g.boarding
            ? `Driver marked ${g.boarding === "boarded" ? "boarded" : "no show"}`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      ...diff.changed.map((g) => ({
        kind: "changed" as const,
        g,
        note: (g.changes ?? []).join(", "),
      })),
    ];

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await onApply();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onCancel}
      panelClassName="flex max-h-[85vh] w-[min(94vw,960px)] max-w-full flex-col overflow-hidden rounded-[12px] border-[0.5px] border-black/10 bg-paper text-[#1a1a1a]"
    >
      <div
        className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b-[0.5px] border-black/[.08] px-4 py-[11px]"
        data-upload-diff
      >
        <b id={titleId} className="text-[14px]">
          {tourTitle} · new CSV
        </b>
        <span className="text-[12.5px] [overflow-wrap:anywhere]">
          {fileName} · {diff.rows} orders, {diff.pax} pax · {n} change
          {n === 1 ? "" : "s"}
          {diff.unchanged ? `, ${diff.unchanged} unchanged` : ""}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {n ? (
          <table className="w-full min-w-[900px] border-collapse text-[13px] tabular-nums">
            <thead>
              <tr>
                {[
                  "Change",
                  "Order #",
                  "Pickup",
                  "Location",
                  "Guest",
                  "Pax",
                  "Note",
                  "Tour",
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      "sticky top-0 border-b border-black/[.12] bg-[#f3f4f2] px-2.5 py-[7px] text-left text-[11px] font-semibold tracking-[.04em] whitespace-nowrap uppercase",
                      h === "Pax" && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ kind, g, note }, i) => (
                <tr
                  key={i}
                  data-diff-row={kind}
                  className="border-b-[0.5px] border-black/[.08] align-top"
                >
                  <td
                    className={cn(
                      "px-2.5 py-[7px] font-semibold whitespace-nowrap",
                      KIND[kind].cls,
                    )}
                  >
                    {KIND[kind].label}
                  </td>
                  <td className="px-2.5 py-[7px] font-mono text-[12px] whitespace-nowrap">
                    {g.order_number}
                  </td>
                  <td className="px-2.5 py-[7px] font-mono text-[12px] whitespace-nowrap">
                    {g.pickup_time}
                  </td>
                  <td className="px-2.5 py-[7px]">{g.pickup_location}</td>
                  <td className="px-2.5 py-[7px]">{g.name}</td>
                  <td className="px-2.5 py-[7px] text-right">{g.pax}</td>
                  <td className="px-2.5 py-[7px] text-[12px]">{note}</td>
                  <td className="min-w-[220px] px-2.5 py-[7px] text-[12px]">
                    {g.product}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="m-0 px-4 py-3 text-[13px]" data-no-changes>
            No changes: the file matches the list already loaded.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t-[0.5px] border-black/[.08] px-4 pt-3 pb-3.5">
        {error ? (
          <span role="alert" className="mr-auto text-[12.5px] text-[#b3261e]">
            {error}
          </span>
        ) : (
          <span className="mr-auto text-[12px]">
            Nothing changes until you click Apply.
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="h-8 rounded-[9px] border border-black/20 bg-paper px-4 text-[12.5px] font-semibold text-[#1a1a1a] hover:bg-[#ebe9e2] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void apply()}
          className={BTN_BLUE}
        >
          {busy
            ? "Applying…"
            : n
              ? `Apply ${n} change${n === 1 ? "" : "s"}`
              : "Apply"}
        </button>
      </div>
    </Modal>
  );
}
