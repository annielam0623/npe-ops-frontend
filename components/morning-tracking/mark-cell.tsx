"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type {
  MorningTrackingRow,
  TrackingMark,
  TrackingMarkCol,
  TrackingMarkValue,
} from "@/types";

import {
  formatMarkTime,
  isStaffMark,
  MARK_CHOICES,
  markHover,
  markLabel,
  markText,
} from "./config";

/** 一格的保存结果：Saving… / Saved（绿）/ 红字照后端原话。 */
export type MarkSaveStatus =
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/**
 * Tracking 表 Relay / Bus 两列的编辑（No show 改方向，Annie 2026-11-17「动手」，N2 A / N7 A / N9 A）。
 * 改的东西先暂存在页面上（staged），按每格旁边的 Save 才存；有没存的离开页面要拦（页面那边管）。
 */
export interface MarkEditing {
  canEdit: boolean;
  /** `${row.id}:${col}` → 选了什么；null = 选了 Reset（回到司机 / 导游原来标的）。没有这个键 = 没改。 */
  staged: ReadonlyMap<string, TrackingMarkValue | null>;
  status: ReadonlyMap<string, MarkSaveStatus>;
  /** value = undefined ⇒ 撤掉暂存（选回了原来显示的那个）。 */
  onStage: (
    row: MorningTrackingRow,
    col: TrackingMarkCol,
    value: TrackingMarkValue | null | undefined,
  ) => void;
  onSave: (row: MorningTrackingRow, col: TrackingMarkCol) => void;
}

export function markKey(rowId: number, col: TrackingMarkCol): string {
  return `${rowId}:${col}`;
}

const RESET = "__reset";

/** 这一行的 No show 在哪一格（⚠️ Take action / ✓ 谁 放在那一格底下）：导游的 Bus 为准，其次 Relay。 */
export function noShowCol(row: MorningTrackingRow): TrackingMarkCol | null {
  if (row.bus_mark?.value === "no_show") return "bus";
  if (row.relay_mark?.value === "no_show") return "relay";
  return null;
}

export function MarkCell({
  row,
  col,
  edit,
  isNew,
  canTake,
  toggling,
  onToggleAction,
}: {
  row: MorningTrackingRow;
  col: TrackingMarkCol;
  edit: MarkEditing | undefined;
  isNew: boolean;
  canTake: boolean;
  toggling: boolean;
  onToggleAction: (row: MorningTrackingRow, want: "on" | "off") => void;
}) {
  const [open, setOpen] = useState(false);
  // TI 上车 / 不在任何 relay round：后端标了才算（不靠 null 猜）。
  if (col === "relay" && row.relay_applicable === false) {
    return (
      <span
        data-mark-na
        title="This guest is not on a relay. They board the bus at Treasure Island."
        className="text-[#5a7a9a]"
      >
        —
      </span>
    );
  }

  const mark: TrackingMark | null | undefined =
    col === "relay" ? row.relay_mark : row.bus_mark;
  const original: TrackingMark | null | undefined =
    col === "relay" ? row.relay_original : row.bus_original;
  const key = markKey(row.id, col);
  const staged = edit?.staged.get(key);
  const dirty = edit?.staged.has(key) ?? false;
  const status = edit?.status.get(key);
  const canEdit = !!edit?.canEdit;
  const staff = isStaffMark(mark);
  const hover = markHover(mark, original, col);
  const empty = col === "relay" ? "—" : "Not marked";
  const nsHere = noShowCol(row) === col;

  const editing = canEdit && (open || dirty);

  let body;
  if (editing) {
    const value = dirty ? (staged === null ? RESET : staged) : mark?.value;
    body = (
      <span className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label={`${col === "relay" ? "Relay" : "Bus"} mark for ${row.order_number}`}
          data-mark-select={col}
          // 自己点开的才抢焦点；刷新后还留着的暂存不抢。
          autoFocus={open && !dirty}
          value={value ?? ""}
          title={hover || undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            if (v === RESET) edit?.onStage(row, col, null);
            else if (v === mark?.value) edit?.onStage(row, col, undefined);
            else edit?.onStage(row, col, v as TrackingMarkValue);
          }}
          onBlur={() => {
            if (!dirty) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              edit?.onStage(row, col, undefined);
              setOpen(false);
            }
          }}
          className={cn(
            "rounded-[6px] border bg-[#1a2f4a] px-1 py-0.5 font-[inherit] text-[11.5px] text-[#e0eaf6] [color-scheme:dark] outline-none",
            dirty ? "border-[#3b82f6]" : "border-white/20",
          )}
        >
          {!mark ? (
            <option value="" disabled>
              {empty}
            </option>
          ) : null}
          {/* 导游页别的 boarding 状态（G321 合同：Bus 列可能有 boarded / no_show 以外的值）：照 label 列出，不能选回去。 */}
          {mark && !MARK_CHOICES[col].includes(mark.value as TrackingMarkValue) ? (
            <option value={mark.value} disabled>
              {markLabel(mark)}
            </option>
          ) : null}
          {MARK_CHOICES[col].map((v) => (
            <option key={v} value={v}>
              {markText(v)}
            </option>
          ))}
          {staff ? (
            <option value={RESET}>Reset to driver/guide mark</option>
          ) : null}
        </select>
        {dirty ? (
          <button
            type="button"
            data-mark-save={col}
            disabled={status?.kind === "saving"}
            onClick={() => {
              // 存好后回到标记的样子；存失败暂存还在（dirty），照旧是下拉 + Save。
              setOpen(false);
              edit?.onSave(row, col);
            }}
            className="cursor-pointer rounded-[6px] border border-[#3b82f6] bg-[#3b82f6] px-2 py-px text-[11px] font-bold text-white disabled:opacity-60"
          >
            {status?.kind === "saving" ? "Saving…" : "Save"}
          </button>
        ) : null}
      </span>
    );
  } else if (mark) {
    const ns = mark.value === "no_show";
    const at = formatMarkTime(mark.at);
    const pill = (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-[10px] px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap",
          ns
            ? "bg-[rgba(239,68,68,.18)] text-[#fca5a5]"
            : "bg-[rgba(46,204,113,.15)] text-[#2ecc71]",
        )}
      >
        {ns ? "✗" : "✓"} {markLabel(mark)}
        {at ? ` ${at}` : ""}
        {isNew && nsHere ? (
          <span className="ml-1 rounded-[4px] bg-[#ef4444] px-1 text-[9.5px] font-extrabold text-white">
            NEW
          </span>
        ) : null}
      </span>
    );
    body = canEdit ? (
      <button
        type="button"
        data-mark-pill={col}
        title={hover}
        onClick={() => setOpen(true)}
        className="cursor-pointer p-0"
      >
        {pill}
      </button>
    ) : (
      <span data-mark-pill={col} title={hover}>
        {pill}
      </span>
    );
  } else {
    body = canEdit ? (
      <button
        type="button"
        data-mark-pill={col}
        title="Click to mark"
        onClick={() => setOpen(true)}
        className="cursor-pointer p-0 text-[#5a7a9a] underline decoration-dotted"
      >
        {empty}
      </button>
    ) : (
      <span data-mark-pill={col} className="text-[#5a7a9a]">
        {empty}
      </span>
    );
  }

  const who =
    mark && !staff
      ? [mark.vehicle, mark.by].filter(Boolean).join(" ")
      : "";

  return (
    <div
      data-mark-cell={col}
      data-mark-value={mark?.value ?? ""}
      className="flex flex-col items-start gap-1"
    >
      {body}
      {mark && staff ? (
        <span data-mark-edited className="text-[10.5px] text-[#fbbf24]">
          ✎ Edited by {mark.by || "staff"}
          {formatMarkTime(mark.at) ? ` ${formatMarkTime(mark.at)}` : ""}
        </span>
      ) : who ? (
        <span className="text-[11px] text-[#7a9bbe]">{who}</span>
      ) : null}
      {status?.kind === "saved" && !dirty ? (
        <span data-mark-saved className="text-[11px] font-semibold text-[#2ecc71]">
          Saved
        </span>
      ) : null}
      {status?.kind === "error" ? (
        <span
          data-mark-error
          className="max-w-[240px] text-[11px] whitespace-normal text-[#f87171]"
        >
          Not saved: {status.message}
        </span>
      ) : null}
      {nsHere && canTake ? (
        row.ns_unhandled ? (
          <button
            type="button"
            data-ns-take-action
            disabled={toggling}
            onClick={() => onToggleAction(row, "on")}
            className="cursor-pointer p-0 text-[11px] text-[#c47a12] disabled:opacity-50"
          >
            ⚠️ Take action
          </button>
        ) : row.action_taken_by ? (
          <span data-ns-handled className="text-[11px] text-[#2ecc71]">
            ✓ {row.action_taken_by}
          </span>
        ) : null
      ) : null}
    </div>
  );
}
