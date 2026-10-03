"use client";

import { type DragEvent, type ReactNode, useState } from "react";

import { ChannelIcon, WHATSAPP_GREEN } from "@/components/ui/channel-icon";
import { ConversationPreview } from "@/components/ui/conversation-preview";
import { cn } from "@/lib/utils";
import type { TicketsTrackingRow } from "@/types";

import {
  type ColumnKey,
  type DeliveryTone,
  emailLabel,
  formatSubmitted,
  isFileColumn,
  notesHeaderCount,
  productLabel,
  smsLabel,
  STATUS_CLASS,
  STATUS_OPTIONS,
  SYSTEM_COLUMNS,
  type SystemColumnKey,
  uploadedValue,
} from "./config";

const LABEL = Object.fromEntries(
  SYSTEM_COLUMNS.map((c) => [c.key, c.label]),
) as Record<SystemColumnKey, string>;

const TONE_CLASS: Record<DeliveryTone, string> = {
  good: "text-emerald-700",
  bad: "font-semibold text-red-600",
  none: "text-stone-400",
};

export interface TicketsTableProps {
  rows: TicketsTrackingRow[];
  /** 筛选前的全部行：Notes 表头的数字按全部算。 */
  allRows: TicketsTrackingRow[];
  columns: ColumnKey[];
  /** 拖动系统列换位置（上传列固定在最右，不参与拖动）。 */
  onMoveColumn: (from: SystemColumnKey, to: SystemColumnKey) => void;
  onOpenConversation: (row: TicketsTrackingRow) => void;
  onToggleAction: (row: TicketsTrackingRow) => void;
  onChangeStatus: (row: TicketsTrackingRow, value: string) => void;
  /** 正在保存的单（Take action / 状态），防连点。 */
  busyId: number | null;
  now: number;
  placeholder: string | null;
}

export function TicketsTable({
  rows,
  allRows,
  columns,
  onMoveColumn,
  onOpenConversation,
  onToggleAction,
  onChangeStatus,
  busyId,
  now,
  placeholder,
}: TicketsTableProps) {
  const [dragging, setDragging] = useState<SystemColumnKey | null>(null);
  const [dropTarget, setDropTarget] = useState<SystemColumnKey | null>(null);

  function endDrag() {
    setDragging(null);
    setDropTarget(null);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50">
            {columns.map((key) => {
              if (isFileColumn(key)) {
                return (
                  <th
                    key={key}
                    scope="col"
                    title="From the uploaded file"
                    className="bg-amber-50 px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-amber-800 uppercase"
                  >
                    {key.slice(5)}
                  </th>
                );
              }
              return (
                <th
                  key={key}
                  scope="col"
                  draggable
                  onDragStart={(event: DragEvent) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", key);
                    setDragging(key);
                  }}
                  onDragOver={(event: DragEvent) => {
                    if (dragging) {
                      event.preventDefault();
                      setDropTarget(key);
                    }
                  }}
                  onDragLeave={() =>
                    setDropTarget((t) => (t === key ? null : t))
                  }
                  onDrop={(event: DragEvent) => {
                    event.preventDefault();
                    if (dragging && dragging !== key) {
                      onMoveColumn(dragging, key);
                    }
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  className={cn(
                    "cursor-grab px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-stone-500 uppercase select-none",
                    key === "quantities" && "text-center",
                    dragging === key && "opacity-40",
                    dropTarget === key &&
                      dragging !== key &&
                      "shadow-[inset_3px_0_0_#185FA5]",
                  )}
                >
                  <span aria-hidden className="mr-1 text-stone-300">
                    ⠿
                  </span>
                  <HeaderLabel columnKey={key} allRows={allRows} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {placeholder ? (
            <tr>
              <td
                colSpan={Math.max(columns.length, 1)}
                className="px-4 py-12 text-center text-stone-500"
              >
                {placeholder}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-stone-100 align-top last:border-b-0 hover:bg-stone-50/70"
              >
                {columns.map((key, index) => (
                  <Cell
                    key={key}
                    columnKey={key}
                    row={row}
                    // WhatsApp 没人处理而被顶上来的行，第一格画一道绿条说明原因。
                    floated={index === 0 && row.wa_unhandled}
                    now={now}
                    busy={busyId === row.id}
                    onOpenConversation={onOpenConversation}
                    onToggleAction={onToggleAction}
                    onChangeStatus={onChangeStatus}
                  />
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function HeaderLabel({
  columnKey,
  allRows,
}: {
  columnKey: SystemColumnKey;
  allRows: TicketsTrackingRow[];
}) {
  if (columnKey === "notes") {
    const { count, tone } = notesHeaderCount(allRows);
    return (
      <span className="inline-flex items-center gap-1.5 align-middle">
        {LABEL.notes}
        <ChannelIcon channel="sms" />
        <ChannelIcon channel="email" />
        <ChannelIcon channel="web" />
        <span
          title={
            tone === "unhandled"
              ? "Orders with messages nobody has actioned yet"
              : "Orders with messages"
          }
          className={cn(
            "inline-flex min-w-5 justify-center rounded-full px-1.5 py-px text-[10.5px] font-bold",
            tone === "none" && "border border-stone-300 text-stone-400",
            tone === "unhandled" && "bg-red-600 text-white",
            tone === "handled" && "bg-emerald-700 text-white",
          )}
        >
          {count}
        </span>
      </span>
    );
  }
  if (columnKey === "whatsapp") {
    return (
      <span className="inline-flex items-center gap-1.5 align-middle">
        {LABEL.whatsapp}
        <ChannelIcon channel="whatsapp" />
      </span>
    );
  }
  if (columnKey === "email") {
    return (
      <>
        <span aria-hidden className="mr-1 text-blue-500">
          ●
        </span>
        {LABEL.email}
      </>
    );
  }
  if (columnKey === "sms") {
    return (
      <>
        <span aria-hidden className="mr-1 text-orange-500">
          ■
        </span>
        {LABEL.sms}
      </>
    );
  }
  return <>{LABEL[columnKey]}</>;
}

function Cell({
  columnKey,
  row,
  floated,
  now,
  busy,
  onOpenConversation,
  onToggleAction,
  onChangeStatus,
}: {
  columnKey: ColumnKey;
  row: TicketsTrackingRow;
  floated: boolean;
  now: number;
  busy: boolean;
  onOpenConversation: (row: TicketsTrackingRow) => void;
  onToggleAction: (row: TicketsTrackingRow) => void;
  onChangeStatus: (row: TicketsTrackingRow, value: string) => void;
}) {
  const style = floated
    ? { boxShadow: `inset 3px 0 0 ${WHATSAPP_GREEN}` }
    : undefined;
  const base = "px-3 py-2.5 [overflow-wrap:anywhere]";

  if (isFileColumn(columnKey)) {
    return (
      <td style={style} className={cn(base, "text-stone-800")}>
        {uploadedValue(row, columnKey.slice(5)) || "—"}
      </td>
    );
  }

  if (columnKey === "notes" || columnKey === "whatsapp") {
    return (
      <td style={style} className={cn(base, "max-w-72 min-w-52")}>
        <ConversationPreview
          kind={columnKey}
          row={row}
          now={now}
          toggling={busy}
          onOpen={() => onOpenConversation(row)}
          onToggleAction={() => onToggleAction(row)}
        />
      </td>
    );
  }

  let content: ReactNode;
  let className = "";
  switch (columnKey) {
    case "tour":
      content = productLabel(row.tour_type) || "—";
      className = "whitespace-nowrap";
      break;
    case "tour_date":
      content = row.tour_date || "—";
      className = "whitespace-nowrap tabular-nums";
      break;
    case "order_number":
      content = row.order_number;
      className = "font-semibold whitespace-nowrap";
      break;
    case "quantities":
      content = row.quantities ?? "—";
      className = "text-center tabular-nums";
      break;
    case "phone":
      content = row.phone || "—";
      className = "text-xs whitespace-nowrap tabular-nums";
      break;
    case "email": {
      const status = emailLabel(row);
      content = status.label;
      className = cn("whitespace-nowrap", TONE_CLASS[status.tone]);
      break;
    }
    case "sms": {
      const status = smsLabel(row.sms_status);
      content = status.label;
      className = cn("whitespace-nowrap", TONE_CLASS[status.tone]);
      break;
    }
    case "status":
      content = (
        <StatusSelect
          row={row}
          disabled={busy}
          onChange={(value) => onChangeStatus(row, value)}
        />
      );
      break;
    case "submitted_at":
      content = (
        <>
          {formatSubmitted(row.submitted_at)}
          {row.resubmitted ? (
            <span
              title="The guest submitted the form more than once"
              className="font-bold text-red-600"
            >
              {" "}
              ★
            </span>
          ) : null}
        </>
      );
      className = "whitespace-nowrap tabular-nums";
      break;
    default:
      content = row[columnKey] || "—";
  }
  return (
    <td style={style} className={cn(base, "text-stone-800", className)}>
      {content}
    </td>
  );
}

function StatusSelect({
  row,
  disabled,
  onChange,
}: {
  row: TicketsTrackingRow;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const value = row.confirmation_status || "pending";
  const known = STATUS_OPTIONS.some((o) => o.value === value);
  return (
    <select
      aria-label={`Status for ${row.order_number}`}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-60",
        STATUS_CLASS[value] ?? "border-stone-300 bg-white text-stone-700",
      )}
    >
      {/* 下拉里没有的现值（改期申请等）照实显示，只读，不能选回去。 */}
      {!known ? (
        <option value={value} disabled>
          {value === "reschedule_req" ? "↻ Reschedule" : value}
        </option>
      ) : null}
      {STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
