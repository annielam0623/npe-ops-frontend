"use client";

import { type DragEvent, type ReactNode, useState } from "react";

import { ChannelIcon, WHATSAPP_GREEN } from "@/components/ui/channel-icon";
import { ConversationPreview } from "@/components/ui/conversation-preview";
import { cn } from "@/lib/utils";
import type { TourTrackingRow } from "@/types";

import {
  type BubbleTone,
  type ColumnKey,
  type DeliveryTone,
  displayName,
  emailLabel,
  isFileColumn,
  mtlvBubble,
  mtlvCells,
  notesBubble,
  smsLabel,
  STATUS_CLASS,
  STATUS_OPTIONS,
  statusOf,
  type SystemColumnKey,
  ticketsBubble,
  ticketValue,
  type TourMeta,
  uploadedValue,
} from "./config";

const HEAD: Record<SystemColumnKey, ReactNode> = {
  order_number: "Order #",
  status: "Status",
  tour: "Tour",
  tour_date: "Tour Date",
  guest_name: "Guest Name",
  phone: "Phone",
  party: "Party",
  email: "📧 Email",
  sms: "📱 SMS",
  turkey: "🦃 T",
  veggie: "🥗 V",
  beef: "🥩 B",
  mtlv: "🏛️ MTLV",
  tickets: "🎟️ Tickets",
  notes: "Notes",
  whatsapp: "WhatsApp",
  submitted: "Submitted",
};

// 旧页面 .sp-sent / .sp-delivered / .sp-failed（Undelivered 单独是琥珀色 .sp-undelivered，见下面）。
const TONE_CLASS: Record<DeliveryTone, string> = {
  good: "text-[#1e7a45]",
  sent: "text-[#1e7a45]",
  bad: "text-[#c94040]",
  none: "",
};

/** 旧页面表头格（.track-tbl thead td）。 */
const TH =
  "relative border-b border-[#d0e0d4] px-2.5 py-[9px] text-left text-[11px] font-bold tracking-[.02em] whitespace-nowrap select-none";

export interface TourTableProps {
  rows: TourTrackingRow[];
  columns: ColumnKey[];
  meta: TourMeta;
  onMoveColumn: (from: SystemColumnKey, to: SystemColumnKey) => void;
  /** 状态下拉改了还没存的（按行 id）：显示 ✓ 存 / ✕ 撤销。 */
  drafts: ReadonlyMap<number, string>;
  onDraft: (row: TourTrackingRow, value: string | null) => void;
  onSaveStatus: (row: TourTrackingRow) => void;
  onEditLunch: (row: TourTrackingRow) => void;
  onTicketStatus: (
    row: TourTrackingRow,
    value: "pending_send" | "sent" | "cancel",
  ) => void;
  onOpenConversation: (row: TourTrackingRow) => void;
  onToggleAction: (row: TourTrackingRow) => void;
  /** 正在保存的单（状态 / 票 / Take action），防连点。 */
  busyId: number | null;
  now: number;
  placeholder: string | null;
}

export function TourTable({
  rows,
  columns,
  meta,
  onMoveColumn,
  drafts,
  onDraft,
  onSaveStatus,
  onEditLunch,
  onTicketStatus,
  onOpenConversation,
  onToggleAction,
  busyId,
  now,
  placeholder,
}: TourTableProps) {
  const [dragging, setDragging] = useState<SystemColumnKey | null>(null);
  const [dropTarget, setDropTarget] = useState<SystemColumnKey | null>(null);
  const bubbles: Partial<
    Record<SystemColumnKey, { count: number; tone: BubbleTone }>
  > = {
    notes: notesBubble(rows),
    mtlv: mtlvBubble(rows),
    tickets: ticketsBubble(rows),
  };

  function endDrag() {
    setDragging(null);
    setDropTarget(null);
  }

  return (
    <>
      <table className="w-max min-w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr>
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
              const bubble = bubbles[key];
              return (
                <th
                  key={key}
                  scope="col"
                  data-col={key}
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
                    if (dragging && dragging !== key)
                      onMoveColumn(dragging, key);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  className={cn(
                    TH,
                    "cursor-grab bg-[linear-gradient(180deg,#edf5ef_0%,#e4ede7_100%)] text-[#1a3a2a]",
                    dragging === key && "bg-[#d4e8d8] opacity-40",
                    dropTarget === key &&
                      dragging !== key &&
                      "shadow-[inset_2px_0_0_#2f5e46]",
                  )}
                >
                  {key === "notes" || key === "whatsapp" ? (
                    <span className="mr-[5px] inline-flex items-center gap-[3px] align-middle">
                      {key === "notes" ? (
                        <>
                          <ChannelIcon channel="sms" inherit />
                          <ChannelIcon channel="email" inherit />
                          <ChannelIcon channel="web" inherit />
                        </>
                      ) : (
                        <ChannelIcon channel="whatsapp" inherit />
                      )}
                    </span>
                  ) : null}
                  {HEAD[key]}
                  {bubble ? (
                    <>
                      {" "}
                      <Bubble {...bubble} col={key} />
                    </>
                  ) : null}
                  {/* 拖动把手在列名后面（同旧页面这一页）。 */}
                  <span
                    aria-hidden
                    className="mr-1 text-[10px] tracking-[1px] text-[#bbb]"
                  >
                    ⠿
                  </span>
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
                className="p-6 text-center text-[#ccc]"
              >
                {placeholder}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                data-id={row.id}
                className="border-b border-[rgba(208,224,212,0.5)] last:border-b-0 even:bg-[rgba(244,240,230,0.35)] hover:bg-[#ddede1]"
              >
                {columns.map((key, index) => (
                  <Cell
                    key={key}
                    columnKey={key}
                    row={row}
                    meta={meta}
                    // WhatsApp 没人处理而被顶上来的行，第一格画一道绿条说明原因。
                    floated={index === 0 && row.wa_unhandled}
                    draft={drafts.get(row.id)}
                    busy={busyId === row.id}
                    // 一次只存一单：别的单在存时这一行的下拉和 ✓ 也先关着（不然点了没反应）。
                    locked={busyId !== null}
                    now={now}
                    onDraft={onDraft}
                    onSaveStatus={onSaveStatus}
                    onEditLunch={onEditLunch}
                    onTicketStatus={onTicketStatus}
                    onOpenConversation={onOpenConversation}
                    onToggleAction={onToggleAction}
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

const BUBBLE_TITLE: Partial<
  Record<SystemColumnKey, Record<BubbleTone, string>>
> = {
  notes: {
    none: "No messages",
    todo: "Orders with messages nobody has actioned yet",
    done: "Orders with messages (all actioned)",
  },
  mtlv: {
    none: "No MTLV guests",
    todo: "MTLV guests not settled yet (no reply, or ticket not sent / cancelled)",
    done: "MTLV guests, all settled",
  },
  tickets: {
    none: "No MTLV tickets to send",
    todo: "MTLV tickets still to send",
    done: "MTLV tickets sent or cancelled",
  },
};

function Bubble({
  count,
  tone,
  col,
}: {
  count: number;
  tone: BubbleTone;
  col: SystemColumnKey;
}) {
  return (
    <span
      data-bubble={col}
      title={BUBBLE_TITLE[col]?.[tone]}
      className={cn(
        "ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] border-[1.5px] px-[5px] align-middle text-[10px] font-bold",
        tone === "none" && "border-[#ced4da] bg-white text-[#aaa]",
        tone === "todo" && "border-[#dc3545] bg-[#dc3545] text-white",
        tone === "done" && "border-[#28a745] bg-[#28a745] text-white",
      )}
    >
      {count}
    </span>
  );
}

const DASH = <span className="text-[#ccc]">—</span>;

function Cell({
  columnKey,
  row,
  meta,
  floated,
  draft,
  busy,
  locked,
  now,
  onDraft,
  onSaveStatus,
  onEditLunch,
  onTicketStatus,
  onOpenConversation,
  onToggleAction,
}: {
  columnKey: ColumnKey;
  row: TourTrackingRow;
  meta: TourMeta;
  floated: boolean;
  draft: string | undefined;
  busy: boolean;
  locked: boolean;
  now: number;
  onDraft: TourTableProps["onDraft"];
  onSaveStatus: TourTableProps["onSaveStatus"];
  onEditLunch: TourTableProps["onEditLunch"];
  onTicketStatus: TourTableProps["onTicketStatus"];
  onOpenConversation: TourTableProps["onOpenConversation"];
  onToggleAction: TourTableProps["onToggleAction"];
}) {
  const style = floated
    ? { boxShadow: `inset 3px 0 0 ${WHATSAPP_GREEN}` }
    : undefined;
  const base =
    "px-2.5 py-[9px] align-middle text-[#1f2d25] [overflow-wrap:anywhere]";

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
        data-c={columnKey}
        className="min-w-[180px] cursor-pointer p-0 align-middle"
      >
        <ConversationPreview
          theme="tour"
          kind={columnKey}
          // Tour 的确认页留言在 notes 里：Notes 列没有消息时显示它（同旧页面）。
          row={{ ...row, guest_notes: row.notes }}
          now={now}
          toggling={busy}
          onOpen={() => onOpenConversation(row)}
          onToggleAction={() => onToggleAction(row)}
        />
      </td>
    );
  }

  const status = statusOf(row);
  const lunchOpen = meta.hasLunch(row.tour_type) && status === "yes";
  let content: ReactNode;
  let className = "";
  switch (columnKey) {
    case "order_number":
      content = row.order_number || "—";
      className = "font-semibold whitespace-nowrap text-[#2F7851]";
      break;
    case "status":
      content = (
        <StatusCell
          row={row}
          draft={draft}
          busy={locked}
          onDraft={onDraft}
          onSave={onSaveStatus}
        />
      );
      break;
    case "tour":
      content = meta.abbr(row.tour_type);
      className = "text-[11px] font-semibold text-[#2F7851]";
      break;
    case "tour_date":
      content = row.tour_date || "—";
      className = "text-[11px] whitespace-nowrap";
      break;
    case "guest_name":
      content = displayName(row);
      break;
    case "phone":
      content = row.phone || "—";
      className = "text-[11px] whitespace-nowrap text-[#888]";
      break;
    case "party":
      content = row.quantities ?? "—";
      className = "text-center";
      break;
    case "email":
    case "sms": {
      const s =
        columnKey === "email" ? emailLabel(row) : smsLabel(row.sms_status);
      content =
        s.label === "—" ? (
          DASH
        ) : (
          <span
            className={cn(
              "inline-block text-[11px] font-semibold",
              s.label === "Undelivered" ? "text-[#c97a00]" : TONE_CLASS[s.tone],
            )}
          >
            {s.label}
          </span>
        );
      break;
    }
    case "turkey":
    case "veggie":
    case "beef": {
      const value =
        columnKey === "turkey"
          ? row.lunch_turkey
          : columnKey === "veggie"
            ? row.lunch_veggie
            : row.lunch_beef;
      const show =
        lunchOpen && (columnKey !== "beef" || meta.hasBeef(row.tour_type));
      content = show ? (
        <button
          type="button"
          title="Edit lunch selection"
          onClick={() => onEditLunch(row)}
          className="cursor-pointer border-b border-dashed border-[#d0e0d4] font-semibold text-[#1f2d25] hover:text-[#2f5e46]"
        >
          {value || 0}
        </button>
      ) : (
        DASH
      );
      className = "text-center";
      break;
    }
    case "mtlv": {
      const m = mtlvCells(row);
      content =
        m.kind === "none" ? (
          DASH
        ) : m.kind === "cancel" ? (
          <span className="text-[11px] text-[#aaa] line-through">0</span>
        ) : m.kind === "waiting" ? (
          <span className="inline-block rounded-[10px] bg-[#dbeafe] px-2 py-0.5 text-[11px] font-bold text-[#1e40af]">
            Pending
          </span>
        ) : (
          <span className="inline-block rounded-[3px] bg-[#ede7f6] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[#512da8]">
            🎫 {m.qty}
          </span>
        );
      className = "text-center";
      break;
    }
    case "tickets": {
      const m = mtlvCells(row);
      if (m.kind === "none") {
        content = DASH;
      } else {
        const value = ticketValue(row);
        content = (
          <span className="flex flex-col items-start gap-0.5">
            <select
              aria-label={`MTLV tickets for ${row.order_number}`}
              value={value}
              disabled={locked}
              onChange={(e) =>
                onTicketStatus(
                  row,
                  e.target.value as "pending_send" | "sent" | "cancel",
                )
              }
              className={cn(
                "cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[11px] font-semibold outline-none focus:outline-1 focus:outline-[#2f5e46] disabled:opacity-60",
                value === "sent"
                  ? "text-[#1e7a45]"
                  : value === "cancel"
                    ? "text-[#aaa] line-through"
                    : "text-[#185FA5]",
              )}
            >
              <option value="pending_send">Pending</option>
              <option value="sent">Sent</option>
              <option value="cancel">Cancel</option>
            </select>
            {m.kind === "qty" && m.sent && row.mtlv_ticket_sent_by ? (
              <span className="text-[10px] leading-tight whitespace-nowrap">
                <span className="font-semibold text-[#2F7851]">
                  ✓ {row.mtlv_ticket_sent_by}
                </span>
                {row.mtlv_ticket_sent_at ? (
                  <span className="block text-[#aaa]">
                    {row.mtlv_ticket_sent_at}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        );
      }
      break;
    }
    case "submitted":
      content = row.submitted_at || "—";
      className = "text-[11px] whitespace-nowrap text-[#888]";
      break;
  }
  return (
    <td style={style} data-c={columnKey} className={cn(base, className)}>
      {content}
    </td>
  );
}

function StatusCell({
  row,
  draft,
  busy,
  onDraft,
  onSave,
}: {
  row: TourTrackingRow;
  draft: string | undefined;
  busy: boolean;
  onDraft: TourTableProps["onDraft"];
  onSave: TourTableProps["onSaveStatus"];
}) {
  const saved = statusOf(row);
  const value = draft ?? saved;
  const known = STATUS_OPTIONS.some((o) => o.value === value);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <select
        aria-label={`Status for ${row.order_number}`}
        value={value}
        disabled={busy}
        onChange={(e) =>
          onDraft(row, e.target.value === saved ? null : e.target.value)
        }
        className={cn(
          "cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[11px] font-bold outline-none focus:outline-1 focus:outline-[#2f5e46] disabled:opacity-60",
          STATUS_CLASS[value] ?? "text-[#1f2d25]",
        )}
      >
        {!known ? (
          <option value={value} disabled>
            {value}
          </option>
        ) : null}
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {row.submission_count > 1 ? (
        <span
          title="The guest submitted the form more than once"
          className="ml-0.5 text-[11px] text-[#e74c3c]"
        >
          ★
        </span>
      ) : null}
      {draft !== undefined ? (
        <>
          <button
            type="button"
            aria-label={`Save status for ${row.order_number}`}
            title="Save"
            disabled={busy}
            onClick={() => onSave(row)}
            className="inline-flex size-5 cursor-pointer items-center justify-center rounded border-none bg-[#2f5e46] text-[11px] text-white hover:bg-[#1a3a2a] disabled:opacity-50"
          >
            ✓
          </button>
          <button
            type="button"
            aria-label={`Undo status for ${row.order_number}`}
            title="Undo"
            disabled={busy}
            onClick={() => onDraft(row, null)}
            className="inline-flex size-5 cursor-pointer items-center justify-center rounded border-none bg-[#eee] text-[11px] text-[#555] hover:bg-[#ddd] disabled:opacity-50"
          >
            ✕
          </button>
        </>
      ) : null}
    </span>
  );
}
