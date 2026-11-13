"use client";

import { useId } from "react";

import { otherDayLabel, sendToday } from "@/lib/other-day";

import { DARK_PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";
import { Modal } from "./modal";

/**
 * 135：要发的日子不是今天时，点发送键先弹这个框（Annie 2026-11-13）。
 * 日期大号红字；确认键原文 "Yes, I need to send for {date}"（Annie 明确不能写 Send anyway），蓝色（提交键）；
 * Cancel 什么都不发（默认焦点在 Cancel，回车不会误发）。
 */
export function OtherDayConfirm({
  date,
  what,
  onYes,
  onCancel,
}: {
  /** 要发的日子，YYYY-MM-DD。 */
  date: string;
  /** 发的是什么，例如 "the 1st Round reminder to 12 guests"。 */
  what: string;
  onYes: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const label = otherDayLabel(date);
  return (
    <Modal titleId={titleId} onDismiss={onCancel} night>
      <div data-other-day-confirm={date} className="flex flex-col gap-4">
        <h2
          id={titleId}
          className="text-lg font-semibold text-stone-900 night:text-white/90"
        >
          This is not today
        </h2>
        <div className="flex flex-col gap-2 text-sm text-[#1a1a1a] night:text-white/75">
          <p>You are about to send {what} for</p>
          <p
            data-other-day-date
            className="text-[28px] leading-tight font-bold text-[#A32D2D] night:text-red-300"
          >
            {label}
          </p>
          <p>
            Today is {otherDayLabel(sendToday())} (Los Angeles time). Messages
            go out right away and cannot be recalled.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            autoFocus
            data-other-day-cancel
            onClick={onCancel}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            data-other-day-yes
            onClick={onYes}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            Yes, I need to send for {label}
          </button>
        </div>
      </div>
    </Modal>
  );
}
