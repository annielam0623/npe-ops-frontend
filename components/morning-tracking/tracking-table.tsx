"use client";

import { type DragEvent, type ReactNode, useState } from "react";

import {
  ChannelIcon,
  WHATSAPP_GREEN,
  WhatsAppWindowPill,
} from "@/components/ui/channel-icon";
import { channelKey, isInbound, whatsappWindow } from "@/lib/channels";
import { cn } from "@/lib/utils";
import type { MorningTrackingRow } from "@/types";

import {
  type ColumnKey,
  COLUMNS,
  type DeliveryTone,
  emailStatusOf,
  formatCheckinTime,
  notesHeaderCount,
  smsStatusOf,
} from "./config";

const LABEL: Record<ColumnKey, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.label]),
) as Record<ColumnKey, string>;

const TONE_CLASS: Record<DeliveryTone, string> = {
  good: "text-emerald-700",
  bad: "font-semibold text-red-600",
  neutral: "text-stone-700",
  none: "text-stone-400",
};

export interface TrackingTableProps {
  rows: MorningTrackingRow[];
  /** 筛选前的全部行：Notes 表头的数字按全部算。 */
  allRows: MorningTrackingRow[];
  columnOrder: ColumnKey[];
  onReorder: (order: ColumnKey[]) => void;
  onOpenConversation: (row: MorningTrackingRow) => void;
  onToggleAction: (row: MorningTrackingRow) => void;
  /** 正在切换 Take action 的单（防连点）。 */
  togglingId: number | null;
  now: number;
  placeholder: string | null;
}

export function TrackingTable({
  rows,
  allRows,
  columnOrder,
  onReorder,
  onOpenConversation,
  onToggleAction,
  togglingId,
  now,
  placeholder,
}: TrackingTableProps) {
  const [dragging, setDragging] = useState<ColumnKey | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnKey | null>(null);

  function handleDrop(target: ColumnKey) {
    if (dragging && dragging !== target) {
      const next = columnOrder.filter((k) => k !== dragging);
      next.splice(next.indexOf(target), 0, dragging);
      onReorder(next);
    }
    setDragging(null);
    setDropTarget(null);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50">
            {columnOrder.map((key) => (
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
                onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
                onDrop={(event: DragEvent) => {
                  event.preventDefault();
                  handleDrop(key);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
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
            ))}
          </tr>
        </thead>
        <tbody>
          {placeholder ? (
            <tr>
              <td
                colSpan={columnOrder.length}
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
                {columnOrder.map((key, index) => (
                  <Cell
                    key={key}
                    columnKey={key}
                    row={row}
                    // WhatsApp 没人处理而被顶上来的行，第一格画一道绿条说明原因。
                    floated={index === 0 && row.wa_unhandled}
                    now={now}
                    toggling={togglingId === row.id}
                    onOpenConversation={onOpenConversation}
                    onToggleAction={onToggleAction}
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
  columnKey: ColumnKey;
  allRows: MorningTrackingRow[];
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
  return <>{LABEL[columnKey]}</>;
}

function Cell({
  columnKey,
  row,
  floated,
  now,
  toggling,
  onOpenConversation,
  onToggleAction,
}: {
  columnKey: ColumnKey;
  row: MorningTrackingRow;
  floated: boolean;
  now: number;
  toggling: boolean;
  onOpenConversation: (row: MorningTrackingRow) => void;
  onToggleAction: (row: MorningTrackingRow) => void;
}) {
  const style = floated
    ? { boxShadow: `inset 3px 0 0 ${WHATSAPP_GREEN}` }
    : undefined;
  const base = "px-3 py-2.5 [overflow-wrap:anywhere]";

  if (columnKey === "notes" || columnKey === "whatsapp") {
    return (
      <td style={style} className={cn(base, "max-w-72 min-w-56")}>
        <ConversationPreview
          kind={columnKey}
          row={row}
          now={now}
          toggling={toggling}
          onOpen={() => onOpenConversation(row)}
          onToggleAction={() => onToggleAction(row)}
        />
      </td>
    );
  }

  let content: ReactNode;
  let className = "";
  switch (columnKey) {
    case "order_number":
      content = row.order_number;
      className = "font-semibold whitespace-nowrap text-[#185FA5]";
      break;
    case "checkin_status":
      content =
        row.checkin_status === "checked_in" ? (
          <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-emerald-700">
            ✓ Checked In
          </span>
        ) : (
          <span className="inline-block rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-orange-600">
            ⏳ Pending
          </span>
        );
      break;
    case "checkin_time":
      content = formatCheckinTime(row.checkin_time);
      className = "whitespace-nowrap tabular-nums";
      break;
    case "quantities":
      content = row.quantities || "—";
      className = "text-center font-semibold tabular-nums";
      break;
    case "vehicle_no":
    case "pickup_time":
      content = row[columnKey] || "—";
      className = "font-semibold whitespace-nowrap";
      break;
    case "sms_status": {
      const status = smsStatusOf(row.sms_status);
      content = status.label;
      className = cn("whitespace-nowrap", TONE_CLASS[status.tone]);
      break;
    }
    case "email_status": {
      const status = emailStatusOf(row.email_state);
      content = status.label;
      className = cn("whitespace-nowrap", TONE_CLASS[status.tone]);
      break;
    }
    case "phone":
      content = row.phone || "—";
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

/**
 * Notes / WhatsApp 两列的预览：最新一条是谁说的、说了什么，点开对话弹窗。
 * Take action 只出现在其中一列（最新消息所在的那列），避免一行两个开关。
 */
function ConversationPreview({
  kind,
  row,
  now,
  toggling,
  onOpen,
  onToggleAction,
}: {
  kind: "notes" | "whatsapp";
  row: MorningTrackingRow;
  now: number;
  toggling: boolean;
  onOpen: () => void;
  onToggleAction: () => void;
}) {
  const isWa = kind === "whatsapp";
  const count = isWa ? row.wa_count : row.notes_count;

  if (!count) {
    // WhatsApp 只能客人先发，我们不能主动开对话：空格子不可点。
    if (isWa) {
      return null;
    }
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-full border border-stone-300 px-2.5 py-0.5 text-xs text-stone-500 hover:border-stone-400 hover:text-stone-800"
      >
        💬 Chat
      </button>
    );
  }

  const direction = isWa ? row.latest_wa_direction : row.latest_note_direction;
  const author = isWa ? row.latest_wa_author : row.latest_note_author;
  const body = isWa ? row.latest_wa_body : row.latest_note_body;
  const icon = isWa
    ? "whatsapp"
    : channelKey(row.latest_note_channel, row.latest_note_direction);
  const who = isInbound(direction) ? "Guest" : author || "Staff";
  const win = isWa ? whatsappWindow(row.wa_in_ts, row.wa_fallback, now) : null;
  const showAction = isWa ? row.wa_is_newer : !row.wa_is_newer;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-md border-l-[3px] px-2.5 py-1.5 text-left transition hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-sky-500",
        isWa
          ? "border-[#1f9d52] bg-emerald-50/70"
          : "border-[#c47a12] bg-amber-50/80",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-stone-700">
        {icon ? <ChannelIcon channel={icon} /> : null}
        <span>{who}</span>
        <span className="rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">
          {count}
        </span>
        {win ? <WhatsAppWindowPill win={win} /> : null}
      </div>
      <p className="line-clamp-2 text-[13px] leading-snug text-stone-800">
        {body}
      </p>
      {showAction ? (
        <button
          type="button"
          disabled={toggling}
          onClick={(event) => {
            event.stopPropagation();
            onToggleAction();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "self-start text-xs font-semibold disabled:opacity-50",
            row.action_taken_by
              ? "text-emerald-700 hover:text-emerald-900"
              : "text-orange-600 hover:text-orange-800",
          )}
        >
          {row.action_taken_by ? (
            <>
              ✓ {row.action_taken_by}{" "}
              <span className="font-normal text-stone-500">
                (click to undo)
              </span>
            </>
          ) : (
            "⚠️ Take action"
          )}
        </button>
      ) : null}
    </div>
  );
}
