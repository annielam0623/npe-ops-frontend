"use client";

import { useEffect, useState } from "react";

import { useViewOnly } from "@/components/ui/view-only";
import { describeError, isStatus } from "@/lib/api-errors";
import { saveManifestWaiverLink } from "@/lib/manifests-api";
import { cn } from "@/lib/utils";
import type { ManifestRow } from "@/types";

import {
  formatLaDateTime,
  sentAt,
  WAIVER_CHANGED,
  WAIVER_KEY,
  WAIVER_MISSING,
  WAIVER_STATUS_KEY,
} from "./config";

type SaveState = "saving" | "saved" | "failed";

const TAG =
  "ml-1 inline-block rounded px-1.5 text-[11px] font-semibold whitespace-nowrap";

/**
 * 置顶 74：Main manifest 一行的 Waiver link 格（Annie「那4提全部按推荐走，动手」；preview
 * https://claude.ai/artifact/5niqePBqxUsCBqKpLLKCnm 第 1 节）。照 Cfm # 格：虚线底、改了出蓝色 Save / Enter 存、Esc 放弃、
 * 存好闪绿 Saved、失败红字写原因；下面小字谁 · 什么时候；有链接旁边 Open ↗。
 * 只有 waiver_link_required 的行有格子；要 waiver 但没填 ⇒ 红「No waiver link」；发出去以后又改了 ⇒ 黄「Changed since sent」
 * （后端 waiver_status 算，重发成功后自动消失）。只读的人（没有 manifests.edit）只看到链接。
 */
export function WaiverInput({
  row,
  onSaved,
  onDirty,
  onUnauthorized,
}: {
  row: ManifestRow;
  onSaved: (rowKey: string, values: ManifestRow["values"]) => void;
  onDirty: (rowKey: string, dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  const stored = String(row.values[WAIVER_KEY] ?? "");
  const [text, setText] = useState(stored);
  const [status, setStatus] = useState<SaveState | null>(null);
  const [error, setError] = useState("");
  const viewOnly = useViewOnly();
  const required = row.waiver_link_required === true;
  useEffect(() => setText(stored), [stored]);
  const dirty = required && !viewOnly && text.trim() !== stored;
  const rowKey = row.row_key;
  useEffect(() => {
    onDirty(rowKey, dirty);
  }, [rowKey, dirty, onDirty]);
  useEffect(() => () => onDirty(rowKey, false), [rowKey, onDirty]);

  if (!required) return null;

  async function save() {
    if (viewOnly || status === "saving") return;
    const next = text.trim();
    if (next === stored) {
      setText(stored);
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await saveManifestWaiverLink({
        order_number: row.order_number,
        product_code: row.product_code,
        tour_date: row.tour_date,
        waiver_link: next,
      });
      const link = res.waiver_link ?? "";
      // 状态先照本地推（发过又改了 ⇒ Changed since sent），下次读页面以后端为准。
      const waiverStatus = !link
        ? WAIVER_MISSING
        : sentAt(row, "tickets")
          ? WAIVER_CHANGED
          : "";
      onSaved(row.row_key, {
        [WAIVER_KEY]: link,
        waiver_link_by: link ? res.updated_by : null,
        waiver_link_at: link ? res.updated_at : null,
        [WAIVER_STATUS_KEY]: waiverStatus,
      });
      setText(link);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 1400);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setStatus("failed");
      setError(
        isStatus(e, 404)
          ? "This order / product / date is no longer in Rezdy."
          : describeError(e),
      );
    }
  }

  const st = String(row.values[WAIVER_STATUS_KEY] ?? "");
  const by = String(row.values.waiver_link_by ?? "");
  const at = String(row.values.waiver_link_at ?? "");

  return (
    <div data-waiver-cell={row.order_number} className="flex flex-col gap-0.5">
      <span className="inline-flex flex-wrap items-center gap-1">
        {viewOnly ? (
          <span className="max-w-[220px] truncate text-[12px]">
            {stored || "—"}
          </span>
        ) : (
          <input
            type="url"
            aria-label={`Waiver link for ${row.order_number} ${row.product_code}`}
            value={text}
            maxLength={2000}
            placeholder="Paste link"
            disabled={status === "saving"}
            onChange={(e) => {
              setText(e.target.value);
              if (status === "failed") {
                setStatus(null);
                setError("");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setText(stored);
                setStatus(null);
                setError("");
              }
            }}
            className={cn(
              "w-[210px] border-b bg-transparent px-0.5 py-px font-[inherit] text-[12px] text-[#1a1a1a] focus:border-solid focus:outline-none night:text-white night:placeholder:text-white/30",
              status === "saving" &&
                "border-amber-400 bg-amber-50 night:border-amber-400/60 night:bg-amber-400/10",
              status === "saved" &&
                "border-emerald-500 bg-emerald-50 night:border-emerald-400/60 night:bg-emerald-400/10",
              status === "failed" &&
                "border-red-400 bg-red-50 night:border-red-400/60 night:bg-red-400/10",
              !status &&
                "border-dashed border-black/20 focus:border-black/50 night:border-white/25 night:focus:border-white/60",
            )}
          />
        )}
        {dirty || status === "saving" ? (
          <button
            type="button"
            data-waiver-save
            onClick={() => void save()}
            disabled={status === "saving"}
            className="cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] px-2 py-px text-[11px] font-bold whitespace-nowrap text-white disabled:cursor-default disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        ) : status === "saved" ? (
          <span
            role="status"
            data-waiver-saved
            className="text-[11px] font-semibold text-[#047857] night:text-emerald-300"
          >
            Saved
          </span>
        ) : null}
        {stored ? (
          <a
            href={stored}
            target="_blank"
            rel="noopener noreferrer"
            data-waiver-open
            className="text-[11px] text-[#2563eb] no-underline hover:underline night:text-sky-300"
          >
            Open ↗
          </a>
        ) : null}
        {st === WAIVER_MISSING || (!stored && !dirty) ? (
          <span
            data-waiver-status="missing"
            className={cn(TAG, "bg-[#fee2e2] text-[#991b1b]")}
          >
            {WAIVER_MISSING}
          </span>
        ) : st === WAIVER_CHANGED ? (
          <span
            data-waiver-status="changed"
            className={cn(TAG, "bg-[#fef3c7] text-[#92400e]")}
          >
            {WAIVER_CHANGED}
          </span>
        ) : null}
      </span>
      {error ? (
        <span
          role="alert"
          className="max-w-[260px] text-[11px] whitespace-normal text-[#a32d2d] night:text-red-300"
        >
          Not saved: {error}
        </span>
      ) : stored && by ? (
        <span className="text-[10.5px] text-[#78716c] night:text-white/45">
          {by}
          {at ? ` · ${formatLaDateTime(at)}` : ""}
        </span>
      ) : null}
    </div>
  );
}
