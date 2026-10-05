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

const CENTER = new Set<SystemColumnKey>([
  "party",
  "turkey",
  "veggie",
  "beef",
  "mtlv",
  "tickets",
]);

const TONE_CLASS: Record<DeliveryTone, string> = {
  good: "bg-emerald-50 text-emerald-700",
  sent: "bg-sky-50 text-sky-700",
  bad: "bg-red-50 font-semibold text-red-600",
  none: "",
};

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
                    "cursor-grab px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-stone-500 uppercase select-none",
                    CENTER.has(key) && "text-center",
                    dragging === key && "opacity-40",
                    dropTarget === key &&
                      dragging !== key &&
                      "shadow-[inset_3px_0_0_#185FA5]",
                  )}
                >
                  <span aria-hidden className="mr-1 text-stone-300">
                    ⠿
                  </span>
                  <span className="inline-flex items-center gap-1.5 align-middle">
                    {key === "notes" ? (
                      <>
                        <ChannelIcon channel="sms" />
                        <ChannelIcon channel="email" />
                        <ChannelIcon channel="web" />
                      </>
                    ) : key === "whatsapp" ? (
                      <ChannelIcon channel="whatsapp" />
                    ) : null}
                    {HEAD[key]}
                    {bubble ? <Bubble {...bubble} col={key} /> : null}
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
                className="px-4 py-12 text-center text-stone-500"
              >
                {placeholder}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                data-id={row.id}
                className="border-b border-stone-100 align-top last:border-b-0 hover:bg-stone-50/70"
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
    </div>
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
        "inline-flex min-w-5 justify-center rounded-full px-1.5 py-px text-[10.5px] font-bold normal-case",
        tone === "none" && "border border-stone-300 text-stone-400",
        tone === "todo" && "bg-red-600 text-white",
        tone === "done" && "bg-emerald-700 text-white",
      )}
    >
      {count}
    </span>
  );
}

const DASH = <span className="text-stone-300">—</span>;

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
      <td
        style={style}
        data-c={columnKey}
        className={cn(base, "max-w-72 min-w-52")}
      >
        <ConversationPreview
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
      className = "text-xs font-semibold whitespace-nowrap text-[#2F7851]";
      break;
    case "tour_date":
      content = row.tour_date || "—";
      className = "text-xs whitespace-nowrap tabular-nums";
      break;
    case "guest_name":
      content = displayName(row);
      break;
    case "phone":
      content = row.phone || "—";
      className = "text-xs whitespace-nowrap text-stone-500 tabular-nums";
      break;
    case "party":
      content = row.quantities ?? "—";
      className = "text-center tabular-nums";
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
              "rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
              TONE_CLASS[s.tone],
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
          className="rounded px-1.5 font-semibold text-[#2F7851] tabular-nums underline decoration-dotted hover:bg-emerald-50"
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
          <span className="text-xs text-stone-400 line-through">0</span>
        ) : m.kind === "waiting" ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            Pending
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-emerald-700">
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
                "rounded-md border px-1.5 py-0.5 text-xs disabled:opacity-60",
                value === "sent"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : value === "cancel"
                    ? "border-stone-300 bg-stone-100 text-stone-500"
                    : "border-stone-300 bg-white text-stone-700",
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
                  <span className="block text-stone-400">
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
      className = "text-xs whitespace-nowrap text-stone-500";
      break;
  }
  return (
    <td
      style={style}
      data-c={columnKey}
      className={cn(base, "text-stone-800", className)}
    >
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
          "rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-60",
          STATUS_CLASS[value] ?? "border-stone-300 bg-white text-stone-700",
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
          className="font-bold text-red-600"
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
            className="rounded border border-emerald-400 bg-emerald-50 px-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            ✓
          </button>
          <button
            type="button"
            aria-label={`Undo status for ${row.order_number}`}
            title="Undo"
            disabled={busy}
            onClick={() => onDraft(row, null)}
            className="rounded border border-stone-300 bg-white px-1.5 text-xs font-bold text-stone-500 hover:bg-stone-50 disabled:opacity-50"
          >
            ✕
          </button>
        </>
      ) : null}
    </span>
  );
}
