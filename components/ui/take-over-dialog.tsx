"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError, errorCode, isStatus } from "@/lib/api-errors";
import {
  HOLDER_CHANGED,
  type EditLockHolder,
  type EditLockStatus,
} from "@/lib/edit-lock-takeover";
import { LA_TIME_ZONE } from "@/lib/la-date";

/*
 * Super Admin 接手编辑权的确认框（preview v3 第 4 节，K2 A：确认框里的 Take over 红色实心，同 Delete）。
 * Dispatch（this day）和 HR 排班总览（this week）共用。
 * 409 holder_changed：重读谁在编辑，用新的人再问一次（框里红字写后端原话）；没人在编辑了 ⇒ 关框、照常改。
 */

const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

function clockOf(iso: string): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? null
    : CLOCK.format(at).replace(/\s/g, " ");
}

function agoOf(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return "less than a minute ago";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

/** 「Jessica is editing this week (since 3:05 PM, last change 2 min ago). If you take over, …」 */
export function takeOverText(holder: EditLockHolder, scope: "day" | "week"): string {
  const since = clockOf(holder.since);
  const ago = agoOf(holder.last_edit);
  const parts = [since ? `since ${since}` : null, ago ? `last change ${ago}` : null].filter(Boolean);
  return `${holder.by} is editing this ${scope}${parts.length ? ` (${parts.join(", ")})` : ""}. If you take over, changes they haven't saved will be lost. Take over?`;
}

export function TakeOverDialog({
  scope,
  holder: first,
  take,
  reread,
  onTaken,
  onFree,
  onClose,
  onUnauthorized,
}: {
  scope: "day" | "week";
  holder: EditLockHolder;
  /** POST …/take-over（holder_since = 框里写的 since）；失败就抛。 */
  take: (holderSince: string) => Promise<void>;
  /** GET …/edit-lock：holder_changed 以后重读。 */
  reread: () => Promise<EditLockStatus>;
  onTaken: () => void;
  /** 重读时已经没人在编辑了。 */
  onFree: () => void;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [holder, setHolder] = useState(first);
  return (
    <ConfirmDialog
      title="Take over editing?"
      confirmLabel="Take over"
      busyLabel="Taking over…"
      danger
      onClose={onClose}
      onConfirm={async () => {
        try {
          await take(holder.since);
          onTaken();
          return { status: "ok" };
        } catch (e) {
          if (isStatus(e, 401)) {
            onUnauthorized();
            return { status: "redirecting" };
          }
          if (isStatus(e, 409) && errorCode(e) === HOLDER_CHANGED) {
            try {
              const s = await reread();
              if (!s.edit_lock || s.edit_lock.by_me || !s.can_take_over) {
                onFree();
                return { status: "ok" };
              }
              setHolder(s.edit_lock);
            } catch (e2) {
              if (isStatus(e2, 401)) {
                onUnauthorized();
                return { status: "redirecting" };
              }
            }
          }
          return { status: "error", message: describeError(e) };
        }
      }}
    >
      <p data-take-over-text>{takeOverText(holder, scope)}</p>
    </ConfirmDialog>
  );
}
