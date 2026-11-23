"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  NoteText,
  useMentionDirectory,
} from "@/components/staff-notes/mentions";
import {
  StaffNoteComposer,
  StaffNoteList,
} from "@/components/staff-notes/staff-notes";
import { useViewOnly } from "@/components/ui/view-only";
import { newestFirst, type StaffNote } from "@/lib/staff-notes-api";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import type { ManifestRow } from "@/types";

import { oldManifestNote } from "./config";

/**
 * ★ Note 打通（Annie 2026-11-21 动手，preview 9BLMZq2ShCAZeVpbQ1j21A v3 第 1 节）：Main manifest Notes 格。
 * 只放这一行产品的 ★ Note（Q2 B）：格子里最新一条一行截断，列宽不变；多条出「+N more」，没有出灰字「Add note」。
 * 点开小窗：全部（最新在上，谁 · 几点 · 从哪写的）+ 底部写新的（自动记这一行的产品，只加不改）。
 * 手机上小窗是从底部升起的面板。
 */
export function StaffNoteCell({
  row,
  notes,
  onAdded,
  onDirty,
  onUnauthorized,
}: {
  row: ManifestRow;
  notes: readonly StaffNote[];
  onAdded: (row: ManifestRow, note: StaffNote) => void;
  onDirty: (rowKey: string, dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  // partner 只读（Annie 2026-11-22「partner 都能看」）：看得到 ★ Note，没有 Add、没有输入框、没有 @。
  const isPartner = usePermissions().isPartner;
  const viewOnly = useViewOnly() || isPartner;
  // 旧 Notes 框写的还没搬过来（见 oldManifestNote）⇒ 当成最旧的一条照样显示。
  const old = oldManifestNote(row);
  const sorted = newestFirst(old ? [...notes, old] : notes);
  const latest = sorted[0];
  const rowKey = row.row_key;
  const dirtyFor = useCallback(
    (d: boolean) => onDirty(rowKey, d),
    [rowKey, onDirty],
  );
  return (
    <div className="relative max-w-[240px] min-w-[150px] text-[12px]">
      {latest ? (
        <span
          data-staff-note-latest
          title={latest.body}
          className="block max-w-[240px] truncate text-[#1a1a1a] night:text-white/90"
        >
          <span className="mr-1 inline-block rounded-[4px] border border-[#f0d58a] bg-[#fff7e0] px-[5px] text-[10.5px] font-bold text-[#856404]">
            ★
          </span>
          <NoteText
            text={latest.body.replace(/\s*[\r\n]+\s*/g, " ")}
            mentions={latest.mentions}
            teams={latest.mention_teams}
          />
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        {sorted.length > 1 ? (
          <button
            type="button"
            data-staff-note-more
            onClick={() => setOpen(true)}
            className="cursor-pointer text-[11px] font-semibold text-[#1d4ed8] night:text-[#93c5fd]"
          >
            +{sorted.length - 1} more
          </button>
        ) : sorted.length === 1 && viewOnly ? (
          // 只读的人看不到 Add：只有一条时给个 View 打开看全文（格子里是一行截断）。
          <button
            type="button"
            data-staff-note-view
            onClick={() => setOpen(true)}
            className="cursor-pointer text-[11px] text-[#6b6f76] underline decoration-dotted night:text-white/50"
          >
            View
          </button>
        ) : null}
        {sorted.length > 1 && !viewOnly ? (
          <span className="text-[11px] text-[#6b6f76]">·</span>
        ) : null}
        {viewOnly ? null : (
          <button
            type="button"
            data-staff-note-open
            onClick={() => setOpen(true)}
            className="cursor-pointer text-[11px] text-[#6b6f76] underline decoration-dotted night:text-white/50"
          >
            {latest ? "Add" : "Add note"}
          </button>
        )}
      </span>
      {open ? (
        <NotePopover
          row={row}
          notes={sorted}
          viewOnly={viewOnly}
          onClose={() => setOpen(false)}
          onAdded={(n) => onAdded(row, n)}
          onDirty={dirtyFor}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </div>
  );
}

function NotePopover({
  row,
  notes,
  viewOnly,
  onClose,
  onAdded,
  onDirty,
  onUnauthorized,
}: {
  row: ManifestRow;
  notes: readonly StaffNote[];
  viewOnly: boolean;
  onClose: () => void;
  onAdded: (note: StaffNote) => void;
  onDirty: (dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const directory = useMentionDirectory(!viewOnly);
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  const dirty = useCallback(
    (d: boolean) => {
      typingRef.current = d;
      setTyping(d);
      onDirty(d);
    },
    [onDirty],
  );
  // 点外面 / Esc 关；框里打了字没加 ⇒ 不关（字留着，离开页面时由页面的离开提醒问）。
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (
        !typingRef.current &&
        ref.current &&
        !ref.current.contains(e.target as Node)
      )
        onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typingRef.current) onClose();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const product = (row.values?.product_name as string | undefined) ?? "";
  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 z-[95] bg-black/40 sm:hidden"
        onClick={() => !typingRef.current && onClose()}
      />
      <div
        ref={ref}
        role="dialog"
        aria-label={`★ Notes for ${row.order_number}`}
        data-staff-note-popover
        className={cn(
          "z-[96] w-[340px] max-w-[calc(100vw-32px)] rounded-[10px] border border-[#cfd3d8] bg-white p-3 whitespace-normal text-[#1a1a1a] shadow-[0_10px_30px_rgba(0,0,0,.35)] night:border-white/15 night:bg-[#0f1b2b] night:text-white",
          "absolute top-full left-0 mt-1",
          "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:mt-0 max-sm:w-auto max-sm:max-w-none max-sm:rounded-b-none max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))]",
        )}
      >
        <div className="mb-1 flex items-start gap-2">
          <h4 className="min-w-0 flex-1 text-[12px] font-semibold">
            ★ Notes · {row.order_number}
            {product ? (
              <span className="ml-1 inline-block rounded-[4px] border border-[#dde1e6] bg-[#eef0f3] px-[5px] text-[10.5px] font-semibold text-[#3a3f47] night:border-white/15 night:bg-white/[.06] night:text-[#cfe0f5]">
                {product}
              </span>
            ) : null}
          </h4>
          <button
            type="button"
            data-staff-note-close
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer text-[16px] leading-none text-[#6b6f76] hover:text-[#1a1a1a] night:text-white/50"
          >
            ×
          </button>
        </div>
        {notes.length ? (
          <div className="max-h-[220px] overflow-y-auto max-sm:max-h-[40vh]">
            <StaffNoteList notes={notes} showProduct={false} dense />
          </div>
        ) : (
          <p className="text-[12px] text-[#6b6f76] night:text-white/45">
            No ★ Notes for this product yet.
          </p>
        )}
        {viewOnly ? null : (
          <div className="mt-2">
            <StaffNoteComposer
              orderNumber={row.order_number}
              products={[]}
              fixedProductCode={row.product_code}
              source="manifest"
              directory={directory}
              onAdded={onAdded}
              onDirty={dirty}
              onUnauthorized={onUnauthorized}
              compact
              autoFocus={!notes.length}
            />
          </div>
        )}
        {typing ? (
          <p className="mt-1 text-[11px] text-[#6b6f76] night:text-white/45">
            Add the note or clear the box to close.
          </p>
        ) : null}
      </div>
    </>
  );
}
