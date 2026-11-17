"use client";

import { useEffect, useState } from "react";

import { useViewOnly } from "@/components/ui/view-only";
import { describeError, isStatus } from "@/lib/api-errors";
import { saveManifestNote } from "@/lib/manifests-api";
import { cn } from "@/lib/utils";
import type { ManifestRow } from "@/types";

import { formatLaDateTime } from "./config";

type SaveState = "saving" | "saved" | "failed";

/** 单行框里放不下换行：后端存的多行备注在框里显示成一行（题 7 A），鼠标移上去看原文。 */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * 150 Notes（G321 v171，Annie「notes可以先上」）：每行一条给 staff 的备注，存法同 Cfm #——单行框（题 7 A），
 * 改了旁边出蓝色 Save，按 Save 或 Enter 才存，Esc 放弃；存好绿字 Saved，失败红字「Not saved: 后端原话」、保留输入。
 * 没有 manifests.edit ⇒ 只读。不打印、不发客人。
 */
export function NoteInput({
  row,
  onSaved,
  onDirty,
  onUnauthorized,
}: {
  row: ManifestRow;
  onSaved: (
    key: { order_number: string; product_code: string; tour_date: string },
    note: { note: string; by: string; at: string | null },
  ) => void;
  onDirty: (rowKey: string, dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  const stored = row.note ?? "";
  const storedText = oneLine(stored);
  const [text, setText] = useState(storedText);
  const [status, setStatus] = useState<SaveState | null>(null);
  const [error, setError] = useState("");
  const viewOnly = useViewOnly();
  useEffect(() => setText(storedText), [storedText]);
  const dirty = !viewOnly && text.trim() !== storedText;
  const rowKey = row.row_key;
  useEffect(() => {
    onDirty(rowKey, dirty);
  }, [rowKey, dirty, onDirty]);
  // 这一行不在了（换天 / 换标签）：不算没存的。
  useEffect(() => () => onDirty(rowKey, false), [rowKey, onDirty]);

  async function save() {
    if (viewOnly || status === "saving") return;
    const next = text.trim();
    if (next === storedText) {
      setText(storedText);
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const result = await saveManifestNote({
        order_number: row.order_number,
        product_code: row.product_code,
        tour_date: row.tour_date,
        note: next,
      });
      onSaved(
        {
          order_number: row.order_number,
          product_code: row.product_code,
          tour_date: row.tour_date,
        },
        {
          note: result.note,
          by: result.note ? (result.updated_by ?? "") : "",
          at: result.note ? result.updated_at : null,
        },
      );
      setText(oneLine(result.note));
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 1400);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setStatus("failed");
      setError(describeError(e));
    }
  }

  // 鼠标移上去：全文（多行照原样）+ 谁、几点改的。
  const by = row.note_updated_by;
  const at = row.note_updated_at;
  const tip = stored
    ? `${stored}${by || at ? `\n— ${[by, at ? formatLaDateTime(at) : ""].filter(Boolean).join(", ")}` : ""}`
    : undefined;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1">
        <input
          type="text"
          data-note
          aria-label={`Notes for ${row.order_number} ${row.product_code}`}
          title={tip}
          value={text}
          maxLength={1000}
          placeholder={viewOnly ? "" : "Add note"}
          readOnly={viewOnly}
          disabled={status === "saving"}
          onChange={(e) => {
            setText(e.target.value);
            if (status === "failed") setStatus(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setText(storedText);
              setStatus(null);
              setError("");
            }
          }}
          className={cn(
            // 同 Cfm # 格（旧页 .inline-edit）：无框、底下一条虚线；存的状态用底线和底色表示。
            "w-[170px] border-b bg-transparent px-0.5 py-px font-[inherit] text-[12px] text-[#1a1a1a] focus:border-solid focus:outline-none night:text-white night:placeholder:text-white/30",
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
        {dirty || status === "saving" ? (
          <button
            type="button"
            data-note-save
            onClick={() => void save()}
            disabled={status === "saving"}
            className="cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] px-2 py-px text-[11px] font-bold whitespace-nowrap text-white disabled:cursor-default disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        ) : status === "saved" ? (
          <span
            role="status"
            data-note-saved
            className="text-[11px] font-semibold text-[#047857] night:text-emerald-300"
          >
            Saved
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
      ) : null}
    </div>
  );
}
