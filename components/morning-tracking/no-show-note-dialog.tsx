"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/ui/modal";
import type { MorningTrackingRow } from "@/types";

/** 后端 note 上限（tracking/mark，≤ 2000）。 */
const NOTE_MAX = 2000;

/**
 * G372（Annie 2026-11-20「选了no show以后跳出弹窗让staff写notes，写完保存」；preview UAhRhQfyGQYt2D8hWjHqZz ⑤；
 * 2026-11-27「T1 A」「动手」）：点 No show ⇒ 这个弹窗，备注选填。Save 就是提交（标记 + 备注 + 建 / 挂 No show 登记，一步）；
 * Cancel 什么都不改、不发请求。存不上 ⇒ 弹窗留着、红字照后端原话。
 */
export function NoShowNoteDialog({
  row,
  date,
  saving,
  error,
  onSave,
  onCancel,
}: {
  row: MorningTrackingRow;
  /** 「Nov 26」这种。 */
  date: string;
  saving: boolean;
  error: string | null;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const noteId = useId();
  const [note, setNote] = useState("");
  const guest = row.name;
  return (
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : onCancel}
      panelClassName="flex max-w-[420px] flex-col !rounded-[14px] border border-white/20 !bg-[#0f2238] !text-[#f8fafc] shadow-[0_16px_48px_rgba(0,0,0,.55)]"
    >
      <div
        data-ns-note-dialog
        className="flex items-center border-b border-white/12 px-4 pt-3.5 pb-2.5"
      >
        <h2 id={titleId} className="m-0 text-base font-bold">
          Mark No show
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          disabled={saving}
          className="ml-auto text-xl leading-none hover:text-white/70 disabled:opacity-50"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3 text-[13px]">
        <p className="m-0">
          <span className="font-mono">{row.order_number}</span>
          {guest ? ` · ${guest}` : ""} · {date} · Bus
        </p>
        <label htmlFor={noteId} className="flex flex-col gap-1">
          <span className="text-[11.5px] font-bold text-white/62">
            Notes (optional)
          </span>
          <textarea
            id={noteId}
            data-ns-note
            rows={4}
            maxLength={NOTE_MAX}
            value={note}
            disabled={saving}
            placeholder="What happened, who you called…"
            onChange={(e) => setNote(e.target.value)}
            className="w-full resize-y rounded-lg border border-white/20 bg-black/[.28] px-[9px] py-[7px] text-[13px] text-[#f8fafc] [color-scheme:dark] placeholder:text-white/35 focus:border-white/50 focus:outline-none"
          />
        </label>
        <p className="m-0 text-[11.5px] text-white/42">
          Saving also logs a No show report in Daily Operation Report, or adds
          to the open one for this order and day.
        </p>
        {error ? (
          <p role="alert" className="m-0 text-xs text-[#f87171]">
            Not saved: {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-white/12 px-4 pt-2.5 pb-3.5">
        <button
          type="button"
          data-ns-note-save
          disabled={saving}
          onClick={() => onSave(note)}
          className="rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-[18px] py-[7px] text-[13px] font-bold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          data-ns-note-cancel
          disabled={saving}
          onClick={onCancel}
          className="rounded-[9px] border border-white/30 px-3.5 py-[7px] text-[13px] hover:bg-white/[.08] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
