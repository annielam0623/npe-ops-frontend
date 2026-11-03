"use client";

import { type DragEvent, type ReactNode, useRef, useState } from "react";

import { ChannelIcon, WHATSAPP_GREEN } from "@/components/ui/channel-icon";
import { ColResizer, useColumnSizing } from "@/components/ui/column-sizing";
import { ConversationPreview } from "@/components/ui/conversation-preview";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import { sameSiteLiveUrl, vehicleLiveUrl } from "@/lib/vehicles-api";
import type { MorningTrackingRow } from "@/types";

import {
  type ColumnKey,
  COLUMNS,
  type DeliveryTone,
  emailStatusOf,
  formatCheckinTime,
  formatGuestViewed,
  formatMarkTime,
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
  columnOrder: ColumnKey[];
  onReorder: (order: ColumnKey[]) => void;
  onOpenConversation: (row: MorningTrackingRow) => void;
  onToggleAction: (row: MorningTrackingRow, want: "on" | "off") => void;
  /** 正在切换 Take action 的单（防连点）。 */
  togglingId: number | null;
  now: number;
  placeholder: string | null;
  /** 这次刷新新冒出来的 No show（bookings.id）：那一行闪三下、带 NEW（司机实时页 ⑥ A）。 */
  newNoShow?: ReadonlySet<number>;
}

export function TrackingTable({
  rows,
  columnOrder,
  onReorder,
  onOpenConversation,
  onToggleAction,
  togglingId,
  now,
  placeholder,
  newNoShow,
}: TrackingTableProps) {
  const canTake = usePermissions().canRowTakeAction("morning");
  const [dragging, setDragging] = useState<ColumnKey | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnKey | null>(null);
  // 拖表头右边缘调宽 + 按内容自动定列宽（照旧页面，宽度不存）。每次画完行都量，拖过以后不再量。
  const tableRef = useRef<HTMLTableElement>(null);
  const startResize = useColumnSizing(tableRef, [
    rows,
    columnOrder,
    placeholder,
  ]);

  function handleDrop(target: ColumnKey) {
    if (dragging && dragging !== target) {
      // 同旧页面：先拿掉、再插到目标**原来**的位置 ⇒ 往右拖落在目标后面，往左拖落在目标前面。
      const to = columnOrder.indexOf(target);
      const next = columnOrder.filter((k) => k !== dragging);
      next.splice(to, 0, dragging);
      onReorder(next);
    }
    setDragging(null);
    setDropTarget(null);
  }

  return (
    <>
      <table
        ref={tableRef}
        className="w-max min-w-full border-collapse text-[13px] tabular-nums"
      >
        <thead>
          <tr>
            {columnOrder.map((key) => (
              <th
                key={key}
                scope="col"
                // Notes / WhatsApp 装的是客人整段的话，不参与自动列宽（宽度由预览块的 260px 定），同旧页面。
                data-autofit={
                  key === "notes" || key === "whatsapp" ? "skip" : undefined
                }
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
                {/* Notes 表头的数字按筛选后的行算（同旧页面）。 */}
                <HeaderLabel columnKey={key} allRows={rows} />
                <ColResizer
                  onMouseDown={startResize}
                  hoverClass="hover:bg-[rgba(100,160,220,.4)] data-[active]:bg-[rgba(100,160,220,.4)]"
                />
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
                data-ns-row={row.ns_unhandled ? row.order_number : undefined}
                data-ns-new={newNoShow?.has(row.id) || undefined}
                className={cn(
                  "border-b border-white/5 last:border-b-0 hover:bg-white/[.03]",
                  // 司机标了 No show、没人处理：淡红底、顶到最上面（⑥ A）；刚冒出来的闪三下。
                  row.ns_unhandled && "bg-[rgba(239,68,68,.13)]",
                  newNoShow?.has(row.id) &&
                    "animate-[ns-flash_1s_ease-in-out_3]",
                )}
              >
                {columnOrder.map((key, index) => (
                  <Cell
                    key={key}
                    columnKey={key}
                    row={row}
                    // 被顶上来的行，第一格画一道竖条说明原因：No show 红、WhatsApp 没人处理绿。
                    floated={
                      index === 0
                        ? row.ns_unhandled
                          ? "ns"
                          : row.wa_unhandled
                            ? "wa"
                            : null
                        : null
                    }
                    isNew={!!newNoShow?.has(row.id)}
                    canTake={canTake}
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
  return <>{LABEL[columnKey]}</>;
}

function Cell({
  columnKey,
  row,
  floated,
  isNew,
  canTake,
  now,
  toggling,
  onOpenConversation,
  onToggleAction,
}: {
  columnKey: ColumnKey;
  row: MorningTrackingRow;
  floated: "ns" | "wa" | null;
  isNew: boolean;
  canTake: boolean;
  now: number;
  toggling: boolean;
  onOpenConversation: (row: MorningTrackingRow) => void;
  onToggleAction: (row: MorningTrackingRow, want: "on" | "off") => void;
}) {
  const style = floated
    ? {
        boxShadow: `inset 3px 0 0 ${floated === "ns" ? "#ef4444" : WHATSAPP_GREEN}`,
      }
    : undefined;
  const base =
    "px-3 py-2.5 align-middle text-[#c8ddf0] [overflow-wrap:anywhere]";

  // 同旧页面：没消息的 Notes 格整格可点开对话；空的 WhatsApp 格不可点（客人先发才有对话），不显示手形。
  if (columnKey === "notes" || columnKey === "whatsapp") {
    const emptyWa = columnKey === "whatsapp" && !row.wa_count;
    const emptyNotes = columnKey === "notes" && !row.notes_count;
    return (
      <td
        style={style}
        onClick={emptyNotes ? () => onOpenConversation(row) : undefined}
        className={cn("p-0 align-middle", !emptyWa && "cursor-pointer")}
      >
        <ConversationPreview
          theme="morning"
          kind={columnKey}
          row={row}
          now={now}
          toggling={toggling}
          onOpen={() => onOpenConversation(row)}
          onToggleAction={(want) => onToggleAction(row, want)}
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
    case "driver_mark":
      content = (
        <DriverMark
          row={row}
          isNew={isNew}
          canTake={canTake}
          toggling={toggling}
          onToggleAction={onToggleAction}
        />
      );
      break;
    case "quantities":
      content = row.quantities || "—";
      className = "text-center font-semibold";
      break;
    case "vehicle_no": {
      // 车号点了在新标签页打开这台车的 Samsara（同旧页面 2026-10-04）；只认 https，没链接照旧是文字。
      // 有 live_url 先用它（当天有效的临时链接；Samsara 里的永久链接以后会停掉），没有才退回 samsara_url（规则文档 5c）。
      // ⛔ 不嵌 iframe：Samsara 分享页 X-Frame-Options SAMEORIGIN。
      const found = [row.live_url, row.samsara_url].find((u) =>
        u?.startsWith("https://"),
      );
      // live_url 是后端拼的 confirm 地址（`/tracking/vehicle-live`，要登录）：换成同一个网址下的路径，
      // 经转发打开，用 ops 的登录态，不用再登录 confirm（分批切换，Annie 2026-10-10）。
      const mapUrl =
        found === row.live_url && found ? sameSiteLiveUrl(found) : found;
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

/**
 * Driver mark 列（司机实时页 ⑥ A，Annie 2026-11-02「动手」）：司机 / 导游在手机上标的，带几点、哪台车谁标的。
 * No show 没人处理：⚠️ Take action（同 Notes / WhatsApp 那个，点了就算处理过、不再置顶）；处理过写 ✓ 谁（绿）。
 * 司机改回 Picked up / Boarded 后端就不算 No show 了，自己回原位。
 */
function DriverMark({
  row,
  isNew,
  canTake,
  toggling,
  onToggleAction,
}: {
  row: MorningTrackingRow;
  isNew: boolean;
  canTake: boolean;
  toggling: boolean;
  onToggleAction: (row: MorningTrackingRow, want: "on" | "off") => void;
}) {
  const status = row.live_status;
  if (!status) return <span className="text-[#5a7a9a]">—</span>;
  const at = formatMarkTime(row.live_status_at);
  const who = [row.live_van, row.live_driver].filter(Boolean).join(" ");
  const ns = status === "no_show";
  const label = ns
    ? "✗ No show"
    : status === "boarded"
      ? "✓ Boarded"
      : "✓ Picked up";
  return (
    <div data-driver-mark={status} className="flex flex-col items-start gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-[10px] px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap",
          ns
            ? "bg-[rgba(239,68,68,.18)] text-[#fca5a5]"
            : "bg-[rgba(46,204,113,.15)] text-[#2ecc71]",
        )}
      >
        {label}
        {at ? ` ${at}` : ""}
        {isNew ? (
          <span className="ml-1 rounded-[4px] bg-[#ef4444] px-1 text-[9.5px] font-extrabold text-white">
            NEW
          </span>
        ) : null}
      </span>
      {who ? <span className="text-[11px] text-[#7a9bbe]">{who}</span> : null}
      {ns && canTake ? (
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
