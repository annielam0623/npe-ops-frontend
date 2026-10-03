"use client";

import { channelKey, isInbound, whatsappWindow } from "@/lib/channels";
import { cn } from "@/lib/utils";

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
 */
export function ConversationPreview({
  kind,
  row,
  now,
  toggling,
  onOpen,
  onToggleAction,
}: {
  kind: "notes" | "whatsapp";
  row: ConversationPreviewRow;
  now: number;
  toggling: boolean;
  onOpen: () => void;
  onToggleAction: () => void;
}) {
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
