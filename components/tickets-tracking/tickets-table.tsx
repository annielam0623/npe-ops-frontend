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

// 旧页面 .badge-sent / .badge-fail / .badge-none。
const TONE_CLASS: Record<DeliveryTone, string> = {
  good: "text-[12px] font-bold text-[#166534]",
  bad: "text-[12px] font-bold text-[#dc3545]",
  none: "text-[12px] text-[#adb5bd]",
};

/** 旧页面表头 th 的样子。 */
const TH =
  "relative border-b-[1.5px] border-[#d0dae6] px-2.5 py-2 text-left text-[12px] font-bold tracking-[.4px] whitespace-nowrap uppercase select-none";

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
    <>
      <table className="w-max min-w-full border-separate border-spacing-0 overflow-hidden rounded-[10px] border border-[#dde3ea] bg-white tabular-nums shadow-[0_2px_10px_rgba(26,42,60,0.08)]">
        <thead>
          <tr className="bg-[linear-gradient(180deg,#eef2f7,#e4eaf2)]">
            {columns.map((key) => {
              if (isFileColumn(key)) {
                return (
                  <th
                    key={key}
                    scope="col"
                    title="From the uploaded file"
                    className={cn(TH, "bg-[#fff8dd] text-[#8a6d00]")}
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
                    TH,
                    "cursor-grab text-[#2a4a6a]",
                    dragging === key && "bg-[#dde3ea] opacity-40",
                    dropTarget === key &&
                      dragging !== key &&
                      "shadow-[inset_2px_0_0_#1a3a5c]",
                  )}
                >
                  <span
                    aria-hidden
                    className="mr-1 text-[10px] tracking-[1px] text-[#bbb]"
                  >
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
                className="p-6 text-center text-[13px] text-[#aaa]"
              >
                {placeholder}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className="group even:bg-[#fafbfc] [&:last-child>*]:border-b-0"
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
    </>
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
      <>
        <span className="mr-[5px] inline-flex items-center gap-[3px] align-middle">
          <ChannelIcon channel="sms" inherit />
          <ChannelIcon channel="email" inherit />
          <ChannelIcon channel="web" inherit />
        </span>
        {LABEL.notes}{" "}
        <span
          title={
            tone === "unhandled"
              ? "Orders with messages nobody has actioned yet"
              : "Orders with messages"
          }
          className={cn(
            "ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] border-[1.5px] px-[5px] align-middle text-[10px] font-bold tracking-normal",
            tone === "none" && "border-[#ced4da] bg-white text-[#aaa]",
            tone === "unhandled" && "border-[#dc3545] bg-[#dc3545] text-white",
            tone === "handled" && "border-[#28a745] bg-[#28a745] text-white",
          )}
        >
          {count}
        </span>
      </>
    );
  }
  if (columnKey === "whatsapp") {
    return (
      <>
        <span className="mr-[5px] inline-flex items-center gap-[3px] align-middle">
          <ChannelIcon channel="whatsapp" inherit />
        </span>
        {LABEL.whatsapp}
      </>
    );
  }
  if (columnKey === "email") {
    return <>● {LABEL.email}</>;
  }
  if (columnKey === "sms") {
    return <>■ {LABEL.sms}</>;
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
  const base =
    "border-b border-[#f0f3f7] px-2.5 py-2 align-middle text-[13px] text-[#2a3a4a] group-hover:bg-[#dfe1e3] [overflow-wrap:anywhere]";

  if (isFileColumn(columnKey)) {
    return (
      <td
        style={style}
        className={cn(base, "bg-[rgba(255,248,221,0.35)] font-normal")}
      >
        {uploadedValue(row, columnKey.slice(5)) || "—"}
      </td>
    );
  }

  if (columnKey === "notes" || columnKey === "whatsapp") {
    return (
      <td
        style={style}
        className="min-w-[180px] cursor-pointer border-b border-[#f0f3f7] p-0 align-middle group-hover:bg-[#dfe1e3]"
      >
        <ConversationPreview
          theme="tickets"
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
      break;
    case "order_number":
      content = row.order_number;
      className = "font-semibold";
      break;
    case "quantities":
      content = row.quantities ?? "—";
      className = "text-center";
      break;
    case "phone":
      content = row.phone || "—";
      className = "text-[11px]";
      break;
    case "email": {
      const status = emailLabel(row);
      content = <span className={TONE_CLASS[status.tone]}>{status.label}</span>;
      break;
    }
    case "sms": {
      const status = smsLabel(row.sms_status);
      content = <span className={TONE_CLASS[status.tone]}>{status.label}</span>;
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
              className="font-bold text-[#dc3545]"
            >
              {" "}
              ★
            </span>
          ) : null}
        </>
      );
      className = "text-[11px] whitespace-nowrap";
      break;
    default:
      content = row[columnKey] || "—";
  }
  return (
    <td style={style} className={cn(base, className)}>
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
        "cursor-pointer rounded border-none bg-transparent px-1 py-0.5 font-[inherit] text-[13px] font-bold tracking-[.3px] focus:outline-1 focus:outline-[#1a3a5c] disabled:opacity-60",
        STATUS_CLASS[value] ?? "text-[#2a3a4a]",
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
