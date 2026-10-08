"use client";

import { type DragEvent, type ReactNode, useState } from "react";

import { ChannelIcon, WHATSAPP_GREEN } from "@/components/ui/channel-icon";
import { ConversationPreview } from "@/components/ui/conversation-preview";
import { cn } from "@/lib/utils";
import { vehicleLiveUrl } from "@/lib/vehicles-api";
import type { MorningTrackingRow } from "@/types";

import {
  type ColumnKey,
  COLUMNS,
  type DeliveryTone,
  emailStatusOf,
  formatCheckinTime,
  formatGuestViewed,
  notesHeaderCount,
  smsStatusOf,
} from "./config";

const LABEL: Record<ColumnKey, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.label]),
) as Record<ColumnKey, string>;

// SMS / Email 状态文字，照旧页面 .sp-plain.*：只有出问题的上红色，正常的比正文略亮，没状态的「—」灰。
const TONE_CLASS: Record<DeliveryTone, string> = {
  good: "text-[#e0eaf6]",
  bad: "text-[#e74c3c]",
  neutral: "text-[#e0eaf6]",
  none: "text-[#aaa]",
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
    <>
      <table className="w-max min-w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
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
                  "relative cursor-grab border-b border-white/[.08] bg-[#0f2035] px-3 py-[9px] text-left text-[11px] font-bold tracking-[.05em] whitespace-nowrap text-[#7a9bbe] uppercase select-none",
                  dragging === key && "bg-[#0a1e35] opacity-40",
                  dropTarget === key &&
                    dragging !== key &&
                    "shadow-[inset_2px_0_0_#5ba3d9]",
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
            ))}
          </tr>
        </thead>
        <tbody>
          {placeholder ? (
            <tr>
              <td
                colSpan={columnOrder.length}
                className="p-7 text-center text-[#4a6a8a]"
              >
                {placeholder}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-white/5 last:border-b-0 hover:bg-white/[.03]"
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
    </>
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
      <>
        <span className="mr-[5px] inline-flex items-center gap-[3px] align-middle">
          <ChannelIcon channel="sms" inherit />
          <ChannelIcon channel="email" inherit />
          <ChannelIcon channel="web" inherit />
        </span>
        {LABEL.notes}
        <span
          title={
            tone === "unhandled"
              ? "Orders with messages nobody has actioned yet"
              : "Orders with messages"
          }
          className={cn(
            "ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] border-[1.5px] px-[5px] align-middle text-[10px] font-bold",
            tone === "none" && "border-white/25 text-[#7a9bbe]",
            tone === "unhandled" && "border-[#e74c3c] bg-[#e74c3c] text-white",
            tone === "handled" && "border-[#1a6b3a] bg-[#1a6b3a] text-white",
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
  const base =
    "px-3 py-2.5 align-middle text-[#c8ddf0] [overflow-wrap:anywhere]";

  if (columnKey === "notes" || columnKey === "whatsapp") {
    return (
      <td style={style} className="cursor-pointer p-0 align-middle">
        <ConversationPreview
          theme="morning"
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
      content = row.order_number || "—";
      className = "font-semibold text-[#5ba3d9]";
      break;
    case "checkin_status":
      content =
        row.checkin_status === "checked_in" ? (
          <span className="inline-flex items-center gap-[5px] rounded-[10px] bg-[rgba(46,204,113,.15)] px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap text-[#2ecc71]">
            ✓ Checked In
          </span>
        ) : (
          <span className="inline-flex items-center gap-[5px] rounded-[10px] bg-[rgba(230,126,34,.15)] px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap text-[#e67e22]">
            ⏳ Pending
          </span>
        );
      break;
    case "checkin_time":
      content = formatCheckinTime(row.checkin_time);
      className = "text-[11px] text-[#7a9bbe]";
      break;
    case "quantities":
      content = row.quantities || "—";
      className = "text-center font-semibold";
      break;
    case "vehicle_no": {
      // 车号点了在新标签页打开这台车的 Samsara（同旧页面 2026-10-04）；只认 https，没链接照旧是文字。
      // 有 live_url 先用它（当天有效的临时链接；Samsara 里的永久链接以后会停掉），没有才退回 samsara_url（规则文档 5c）。
      // ⛔ 不嵌 iframe：Samsara 分享页 X-Frame-Options SAMEORIGIN。
      const mapUrl = [row.live_url, row.samsara_url].find((u) =>
        u?.startsWith("https://"),
      );
      content =
        row.vehicle_no && mapUrl ? (
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open live location in Samsara"
            className="text-[#5ba3d9] underline"
          >
            {row.vehicle_no}
          </a>
        ) : (
          row.vehicle_no || "—"
        );
      className = "font-semibold";
      break;
    }
    case "driver": {
      // 司机名点了看他**现在**开的那台车（换过车也对），同旧页面 2026-10-08；后端只给车号，地址前端拼（同 Vehicles 的 Open map）。
      const liveVan = row.driver_live_van?.trim();
      content =
        row.driver && liveVan ? (
          <a
            href={vehicleLiveUrl(liveVan)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this driver's current vehicle in Samsara"
            className="text-[#5ba3d9] underline"
          >
            {row.driver}
          </a>
        ) : (
          row.driver || "—"
        );
      break;
    }
    case "guest_viewed":
      content = (
        <>
          {formatGuestViewed(row.guest_viewed_at)}
          {row.guest_link_stale ? (
            <>
              <br />
              <span
                title="Guest is still viewing the old link — the van changed since they clicked. Wrong bus is shown on their page."
                className="text-[10px] font-semibold text-[#e74c3c]"
              >
                Wrong bus — resend link
              </span>
            </>
          ) : null}
        </>
      );
      className = "text-[11px] text-[#7a9bbe]";
      break;
    case "pickup_time":
      content = row[columnKey] || "—";
      className = "font-semibold";
      break;
    case "pickup_location":
      content = row.pickup_location || "—";
      className = "text-[12px]";
      break;
    case "agent_name":
      content = row.agent_name || "—";
      className = "text-[12px] text-[#a0c0e0]";
      break;
    case "sms_status": {
      const status = smsStatusOf(row.sms_status);
      content = (
        <span
          className={cn("text-[11px] font-semibold", TONE_CLASS[status.tone])}
        >
          {status.label}
        </span>
      );
      break;
    }
    case "email_status": {
      const status = emailStatusOf(row.email_state);
      content = (
        <span
          className={cn("text-[11px] font-semibold", TONE_CLASS[status.tone])}
        >
          {status.label}
        </span>
      );
      break;
    }
    case "phone":
      content = row.phone || "—";
      className = "text-[12px] text-[#a0c0e0]";
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
