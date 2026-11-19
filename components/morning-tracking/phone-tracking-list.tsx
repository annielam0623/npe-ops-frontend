"use client";

import { type ReactNode, useState } from "react";

import { WhatsAppWindowPill } from "@/components/ui/channel-icon";
import { isInbound, whatsappWindow } from "@/lib/channels";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import type { MorningTrackingRow } from "@/types";

import {
  type ColumnKey,
  type DeliveryTone,
  emailStatusOf,
  formatCheckinTime,
  smsStatusOf,
} from "./config";
import { noShowCol } from "./mark-cell";
import { cellBody } from "./tracking-table";

/**
 * 手机版（屏宽 < 640px）的 Tracking 列表，代替电脑版的整张表（Annie 2026-11-17「全部按推荐，动手」，
 * 样稿 https://claude.ai/artifact/2Tt9qzDzCYENfiAeEpdjn7）：
 * - 题 1 A：收起时一行 = 圆点 + 名字 + 人数 · 接客时间；
 * - 题 2 A：圆点 = 签到（绿已签、红没签）；要处理的（没处理的 No show / 消息）名字后面 ⚠️，No show 写 NO SHOW、整行淡红底；
 * - 题 3 A：Chat、Take action 只在点开后的详情底下按；
 * - 题 4 A：一次只开一位，点另一位前一位收起；自动刷新时开着的那位照旧开着（按 bookings.id 记）。
 * 详情里各项的写法和电脑版那一格一样（共用 cellBody）；哪些项出现跟电脑版的列一样（columnOrder 已按权限 / 开关筛过）。
 */
export function PhoneTrackingList({
  rows,
  columns,
  onOpenConversation,
  onToggleAction,
  togglingId,
  now,
  placeholder,
  newNoShow,
}: {
  rows: MorningTrackingRow[];
  /** 电脑版此刻会出的列（已去掉没权限 / 没开的）。 */
  columns: ColumnKey[];
  onOpenConversation: (row: MorningTrackingRow) => void;
  onToggleAction: (row: MorningTrackingRow, want: "on" | "off") => void;
  togglingId: number | null;
  now: number;
  placeholder: string | null;
  newNoShow?: ReadonlySet<number>;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const perms = usePermissions();
  const canView = perms.canMessages("messages.view");
  const canTake = perms.canRowTakeAction("morning");
  const has = (key: ColumnKey) => columns.includes(key);

  if (placeholder) {
    return (
      <p className="rounded-[10px] border border-white/[.08] bg-[#1a2f4a] p-6 text-center text-[#4a6a8a]">
        {placeholder}
      </p>
    );
  }

  return (
    <ul
      data-mt-phone-list
      className="overflow-hidden rounded-[10px] border border-white/[.08] bg-[#1a2f4a]"
    >
      {rows.map((row) => {
        const open = openId === row.id;
        // G321：Relay / Bus 分开的新列出来时，按这两列的最终值算 No show（同电脑版 noShowCol）。
        const noShow =
          (has("driver_mark") && row.live_status === "no_show") ||
          ((has("relay_mark") || has("bus_mark")) && noShowCol(row) !== null);
        const msgUnhandled =
          canView &&
          (row.wa_is_newer
            ? row.wa_count > 0 && !!row.wa_unhandled
            : row.notes_count > 0 && !!row.notes_unhandled);
        const needs = (noShow && !!row.ns_unhandled) || msgUnhandled;
        const isNew = !!newNoShow?.has(row.id);
        return (
          <li
            key={row.id}
            data-mt-phone-row={row.order_number}
            data-ns-row={row.ns_unhandled ? row.order_number : undefined}
            data-ns-new={isNew || undefined}
            className={cn(
              "border-t border-white/[.08] first:border-t-0",
              row.ns_unhandled && "bg-[rgba(239,68,68,.13)]",
              isNew && "animate-[ns-flash_1s_ease-in-out_3]",
            )}
          >
            <button
              type="button"
              aria-expanded={open}
              // 不跟全站手机按钮一起缩（globals.css [data-phone-compact]）：一行照样稿 34px 高，手指好点。
              data-phone-keep
              onClick={() => setOpenId(open ? null : row.id)}
              className={cn(
                "flex min-h-[34px] w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[13px]",
                open && !row.ns_unhandled && "bg-[#13263d]",
              )}
            >
              <span aria-hidden className="w-2.5 text-[11px] text-[#5a7a9a]">
                {open ? "▾" : "▸"}
              </span>
              <span
                data-checkin-dot={row.checkin_status}
                title={
                  row.checkin_status === "checked_in"
                    ? "Checked in"
                    : "Not checked in yet"
                }
                className={cn(
                  "h-[9px] w-[9px] flex-none rounded-full",
                  row.checkin_status === "checked_in"
                    ? "bg-[#22c55e]"
                    : "bg-[#ef4444]",
                )}
              />
              <span className="sr-only">
                {row.checkin_status === "checked_in"
                  ? "Checked in. "
                  : "Not checked in yet. "}
              </span>
              <span className="min-w-0 flex-1 truncate text-white">
                {row.name || row.order_number || "—"}
              </span>
              {noShow || needs ? (
                <span
                  data-needs-action={needs || undefined}
                  className={cn(
                    "text-[11px] font-bold whitespace-nowrap",
                    noShow ? "text-[#fca5a5]" : "text-[#f59e0b]",
                  )}
                >
                  {noShow ? "NO SHOW" : ""}
                  {noShow && needs ? " " : ""}
                  {needs ? "⚠️" : ""}
                  {isNew ? (
                    <span className="ml-1 rounded-[4px] bg-[#ef4444] px-1 text-[9.5px] font-extrabold text-white">
                      NEW
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span className="font-mono text-[11px] whitespace-nowrap text-[#7a93ad] tabular-nums">
                {row.quantities || "—"} · {row.pickup_time || "—"}
              </span>
            </button>
            {open ? (
              <PhoneDetail
                row={row}
                has={has}
                canView={canView}
                canTake={canTake}
                needs={needs}
                noShow={noShow}
                now={now}
                toggling={togglingId === row.id}
                onOpenConversation={onOpenConversation}
                onToggleAction={onToggleAction}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const TONE: Record<DeliveryTone, string> = {
  good: "text-[#e0eaf6]",
  bad: "text-[#e74c3c]",
  neutral: "text-[#e0eaf6]",
  none: "text-[#aaa]",
};

function PhoneDetail({
  row,
  has,
  canView,
  canTake,
  needs,
  noShow,
  now,
  toggling,
  onOpenConversation,
  onToggleAction,
}: {
  row: MorningTrackingRow;
  has: (key: ColumnKey) => boolean;
  canView: boolean;
  canTake: boolean;
  needs: boolean;
  noShow: boolean;
  now: number;
  toggling: boolean;
  onOpenConversation: (row: MorningTrackingRow) => void;
  onToggleAction: (row: MorningTrackingRow, want: "on" | "off") => void;
}) {
  // 详情里的 Driver mark 不带自己的 Take action（统一放底下一排，题 3 A）。
  const body = (key: ColumnKey) =>
    cellBody(key, row, {
      isNew: false,
      canTake: false,
      toggling,
      onToggleAction,
    })[0];
  const items: [string, ReactNode][] = [];
  const add = (label: string, value: ReactNode) => items.push([label, value]);

  if (has("order_number")) add("Order #", row.order_number || "—");
  if (has("checkin_status")) {
    add(
      "Check-in",
      row.checkin_status === "checked_in" ? (
        <span className="font-semibold text-[#2ecc71]">
          ✓ Checked In
          {row.checkin_time ? (
            <span className="ml-1 font-normal text-[#7a9bbe]">
              {formatCheckinTime(row.checkin_time)}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="font-semibold text-[#e67e22]">⏳ Pending</span>
      ),
    );
  }
  if (has("driver_mark")) add("Driver mark", body("driver_mark"));
  // G321：手机上只看不改（改 Relay / Bus 用电脑版表格）。
  if (has("relay_mark")) add("Relay", body("relay_mark"));
  if (has("bus_mark")) add("Bus", body("bus_mark"));
  if (has("phone")) add("Phone", row.phone || "—");
  if (has("vehicle_no") || has("driver")) {
    add(
      "Bus # · Driver",
      <>
        {has("vehicle_no") ? body("vehicle_no") : null}
        {has("vehicle_no") && has("driver") ? " · " : null}
        {has("driver") ? body("driver") : null}
      </>,
    );
  }
  if (has("pickup_time") || has("pickup_location")) {
    add(
      "Pickup",
      [
        has("pickup_time") ? row.pickup_time : "",
        has("pickup_location") ? row.pickup_location : "",
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    );
  }
  if (has("guest_viewed")) add("Guest viewed", body("guest_viewed"));
  if (has("arrived_at")) add("Arrived at", body("arrived_at"));
  if (has("left_at")) add("Left at", body("left_at"));
  if (canView && has("notes") && row.notes_count > 0) {
    const who = isInbound(row.latest_note_direction)
      ? "Guest"
      : row.latest_note_author || "Staff";
    add(
      "Notes",
      <MsgLine
        who={who}
        body={row.latest_note_body}
        onOpen={() => onOpenConversation(row)}
      />,
    );
  }
  if (canView && has("whatsapp") && row.wa_count > 0) {
    const who = isInbound(row.latest_wa_direction)
      ? "Guest"
      : row.latest_wa_author || "Staff";
    const win = whatsappWindow(row.wa_in_ts, row.wa_fallback, now);
    add(
      "WhatsApp",
      <MsgLine
        who={who}
        body={row.latest_wa_body}
        extra={win ? <WhatsAppWindowPill win={win} morning /> : null}
        onOpen={() => onOpenConversation(row)}
      />,
    );
  }
  if (has("sms_status") || has("email_status")) {
    const sms = smsStatusOf(row.sms_status);
    const email = emailStatusOf(row.email_state);
    add(
      "SMS · Email",
      <>
        {has("sms_status") ? (
          <span className={cn("font-semibold", TONE[sms.tone])}>
            {sms.label}
          </span>
        ) : null}
        {has("sms_status") && has("email_status") ? " · " : null}
        {has("email_status") ? (
          <span className={cn("font-semibold", TONE[email.tone])}>
            {email.label}
          </span>
        ) : null}
      </>,
    );
  }
  if (has("agent_name")) add("Agent", row.agent_name || "—");

  // 底下一排（题 3 A）：💬 Chat；有要处理的 ⇒ ⚠️ Take action；处理过 ⇒ ✓ 谁（点了撤销，同电脑版）。
  const hasMsgs = row.notes_count > 0 || row.wa_count > 0;
  const handledBy =
    !needs && row.action_taken_by && (noShow || (canView && hasMsgs))
      ? row.action_taken_by
      : "";

  return (
    <div
      data-mt-phone-detail
      className="border-t border-dashed border-white/[.08] bg-[#13263d] px-2.5 pt-1.5 pb-2.5 pl-[30px]"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="whitespace-nowrap text-[#5a7a9a]">{label}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere] text-[#dbe7f3]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {canView ? (
          <button
            type="button"
            data-phone-chat
            onClick={() => onOpenConversation(row)}
            className="cursor-pointer rounded-md border border-white/[.18] bg-[#1a2f4a] px-2.5 py-[3px] text-[12px] text-[#cfe0f2]"
          >
            💬 Chat
          </button>
        ) : null}
        {canTake && needs ? (
          <button
            type="button"
            data-phone-take-action
            disabled={toggling}
            onClick={() => onToggleAction(row, "on")}
            className="cursor-pointer rounded-md border border-[#f59e0b]/50 bg-[#1a2f4a] px-2.5 py-[3px] text-[12px] text-[#fbbf24] disabled:opacity-50"
          >
            ⚠️ Take action
          </button>
        ) : null}
        {canTake && handledBy ? (
          <button
            type="button"
            data-phone-handled
            disabled={toggling}
            onClick={() => onToggleAction(row, "off")}
            className="cursor-pointer rounded-md border border-white/[.12] bg-transparent px-2.5 py-[3px] text-[12px] text-[#2ecc71] disabled:opacity-50"
          >
            ✓ {handledBy}{" "}
            <span className="font-normal text-[#6f8fae]">(tap to undo)</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MsgLine({
  who,
  body,
  extra,
  onOpen,
}: {
  who: string;
  body: string;
  extra?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-phone-keep
      className="block w-full cursor-pointer p-0 text-left"
    >
      <span className="line-clamp-2">
        <span className="text-[#8aa9c8]">{who}: </span>
        {body ? `“${body}”` : "—"}
      </span>
      {extra ? <span className="mt-0.5 block">{extra}</span> : null}
    </button>
  );
}
