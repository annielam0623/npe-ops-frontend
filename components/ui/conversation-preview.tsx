"use client";

import { channelKey, isInbound, whatsappWindow } from "@/lib/channels";
import { cn } from "@/lib/utils";

import type { ConversationTheme } from "./conversation-modal";
import { ChannelIcon, WhatsAppWindowPill } from "./channel-icon";

/** 早班 / 门票 tracking 行里预览要用的字段（两种行都有这些）。 */
export interface ConversationPreviewRow {
  notes_count: number;
  latest_note_author: string;
  latest_note_body: string;
  latest_note_direction: string;
  latest_note_channel: string;
  wa_count: number;
  latest_wa_author: string;
  latest_wa_body: string;
  latest_wa_direction: string;
  wa_is_newer: boolean;
  wa_in_ts: string;
  wa_fallback: string;
  action_taken_by: string;
  /** 门票页才有：客人在确认页填的留言。 */
  guest_notes?: string;
}

/**
 * Notes / WhatsApp 两列的预览：最新一条是谁说的、说了什么，点开对话弹窗。
 * Take action 只出现在其中一列（最新消息所在的那列），避免一行两个开关。
 * 样子照各自旧页面的 convoCell()（Annie 2026-10-07：和旧版一模一样）：
 * - morning：深色底，第一行「图标 + 谁 + 条数」，橙色 / 绿色半透明底；
 * - tickets / tour：浅色底，第一行只有图标，黄色 / 绿色底。
 * 外面的 <td> 要 padding 0（同旧页面），预览块自己铺满格子。
 */
export function ConversationPreview({
  theme,
  kind,
  row,
  now,
  toggling,
  onOpen,
  onToggleAction,
}: {
  theme: ConversationTheme;
  kind: "notes" | "whatsapp";
  row: ConversationPreviewRow;
  now: number;
  toggling: boolean;
  onOpen: () => void;
  onToggleAction: () => void;
}) {
  const dark = theme === "morning";
  const isWa = kind === "whatsapp";
  // 门票页：客人在确认页的留言也算 Notes 里的一条（接口的 notes_count 不含它）。
  const guestNotes = isWa ? "" : (row.guest_notes ?? "");
  const count = isWa ? row.wa_count : row.notes_count;
  const hasContent = count > 0 || !!guestNotes;

  if (!hasContent) {
    // WhatsApp 只能客人先发，我们不能主动开对话：空格子不可点。
    if (isWa) {
      return null;
    }
    return (
      <div className={cn("px-3 py-2.5", !dark && "text-center")}>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "inline-flex cursor-pointer items-center gap-[5px] rounded-md border px-2 py-[3px] text-[11px]",
            dark
              ? "border-white/15 text-[#7a9bbe] hover:border-[#5ba3d9] hover:text-[#a0c0e0]"
              : "border-[#9ED3A9] text-[#2F7851]",
          )}
        >
          💬 Chat
        </button>
      </div>
    );
  }

  const direction = isWa ? row.latest_wa_direction : row.latest_note_direction;
  const author = isWa ? row.latest_wa_author : row.latest_note_author;
  const body = isWa ? row.latest_wa_body : row.latest_note_body || guestNotes;
  const icon = isWa
    ? "whatsapp"
    : count
      ? channelKey(row.latest_note_channel, row.latest_note_direction)
      : "web";
  // 只有确认页留言、没有消息时，说话的是客人。
  const who = isInbound(direction) || !count ? "Guest" : author || "Staff";
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
        "h-full cursor-pointer border-l-[3px] px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-sky-500",
        dark
          ? isWa
            ? "max-w-[260px] border-[#1f9d52] bg-[rgba(37,211,102,.10)]"
            : "max-w-[260px] border-[#c47a12] bg-[rgba(255,193,7,.08)]"
          : isWa
            ? "border-[#25d366] bg-[#f0fbf4]"
            : "border-[#ffc107] bg-[#fffbea]",
      )}
    >
      {dark ? (
        <div className="mb-0.5 inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-[#8aa9c8]">
          {icon ? <ChannelIcon channel={icon} inherit /> : null}
          <span>{who}</span>
          <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-[#c47a12] px-[5px] align-middle text-[10px] font-bold text-white">
            {count}
          </span>
        </div>
      ) : icon ? (
        <div className="mb-0.5 inline-flex items-center gap-1 text-[#555]">
          <ChannelIcon channel={icon} inherit />
        </div>
      ) : null}
      {win ? (
        <div className="mb-[3px]">
          <WhatsAppWindowPill win={win} morning={dark} />
        </div>
      ) : null}
      <p
        className={cn(
          "line-clamp-2 text-[12px] leading-[1.4] whitespace-normal",
          dark ? "text-[#c8ddf0]" : "text-[#555]",
        )}
      >
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
            "mt-1 block cursor-pointer p-0 text-[11px] disabled:opacity-50",
            row.action_taken_by
              ? dark
                ? "text-[#2ecc71]"
                : "font-semibold text-[#28a745]"
              : dark
                ? "text-[#c47a12]"
                : "text-[#856404]",
          )}
        >
          {row.action_taken_by ? (
            <>
              ✓ {row.action_taken_by}{" "}
              <span
                className={cn(
                  "ml-1 font-normal",
                  dark ? "text-[#6f8fae]" : "text-[#aaa]",
                )}
              >
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
