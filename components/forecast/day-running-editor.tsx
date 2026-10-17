"use client";

import { useState } from "react";

import { describeError } from "@/lib/api-errors";
import type { ForecastRunningMeta } from "@/types";

import { describeMeta } from "./config";
import { DAY_INPUT_CLASS, DayDialog } from "./day-dialog";

/** 原因最多几个字（后端同样拦，≤200）。 */
export const REASON_MAX_LENGTH = 200;

type Choice = "open" | "closed" | "auto";

/**
 * 粗体人数格点开：这一天这个团开不开（G81，所有 staff）。
 * 手改过的才有「Back to automatic」；没手改时选的和现在一样就不让存。
 * CCL 在 Discord 写了 Closed 的那天，选 Open 存得进去但不生效，框里先说明。
 */
export function DayRunningEditor({
  title,
  subtitle,
  closed,
  reason,
  meta,
  cclClosed,
  onSave,
  onClose,
}: {
  title: string;
  subtitle: string;
  /** 现在这天显示的是不开团。 */
  closed: boolean;
  /** 现在显示的原因（"Closed" 这种默认词当空处理）。 */
  reason: string;
  meta: ForecastRunningMeta | null;
  /** CCL 在 Discord 写了 Closed（压过手动开团）。 */
  cclClosed: boolean;
  onSave: (running: boolean | null, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const startChoice: Choice = closed ? "closed" : "open";
  const [choice, setChoice] = useState<Choice>(startChoice);
  const [text, setText] = useState(reason === "Closed" ? "" : reason);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const baseReason = reason === "Closed" ? "" : reason;
  // 没改什么就不让存：选的和现在显示的一样（不开团时原因也一样）。
  const canSave =
    choice === "auto"
      ? true
      : choice === "open"
        ? closed
        : !closed || trimmed !== baseReason;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(
        choice === "auto" ? null : choice === "open",
        choice === "closed" ? trimmed : "",
      );
      onClose();
    } catch (e) {
      setError(describeError(e));
      setSaving(false);
    }
  }

  const radio = (value: Choice, label: string) => (
    <label className="flex items-center gap-2 text-sm text-white/85">
      <input
        type="radio"
        name="day-running"
        value={value}
        checked={choice === value}
        disabled={saving}
        onChange={() => setChoice(value)}
        className="h-3.5 w-3.5 accent-sky-500"
      />
      {label}
    </label>
  );

  return (
    <DayDialog
      title={title}
      subtitle={subtitle}
      error={error}
      saving={saving}
      canSave={canSave}
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <div className="mt-3 space-y-2">
        {radio("open", "Running")}
        {radio("closed", "Not running")}
        {choice === "closed" ? (
          <input
            type="text"
            aria-label="Reason"
            autoFocus
            value={text}
            maxLength={REASON_MAX_LENGTH}
            disabled={saving}
            placeholder="Reason (optional), e.g. Canyon closed"
            onChange={(event) => setText(event.target.value)}
            className={DAY_INPUT_CLASS}
          />
        ) : null}
        {meta ? radio("auto", "Back to automatic") : null}
      </div>
      {meta?.overridden_by_ccl || (cclClosed && choice === "open") ? (
        <p
          data-ccl-note
          className="mt-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-100"
        >
          CCL wrote Closed for this day, so it stays closed even if you pick
          Running.
        </p>
      ) : null}
      {meta ? (
        <p className="mt-2 text-[11px] text-white/45">
          Changed here {describeMeta(meta)}.
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-white/45">
          Applies to this day only. Weekly days and closed dates stay in
          Settings → Products.
        </p>
      )}
    </DayDialog>
  );
}
