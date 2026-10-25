"use client";

import { useState } from "react";

import { PageLink } from "@/components/ui/page-link";
import { cn } from "@/lib/utils";
import type { NotificationSwitch } from "@/types/notification-switches";

import {
  SCHEDULE_CONFIRM_KEY,
  confirmText,
  formatSince,
  normalizeSample,
} from "./config";

/** 周三排班确认卡片里要改的发送时刻。 */
export interface TimeEditor {
  saved: string;
  saving: boolean;
  onSave: (time: string) => void;
}

export interface CardProps {
  item: NotificationSwitch;
  /** 开着吗（定时自动发送：任何一边开着就算开）。 */
  on: boolean;
  /** 定时自动发送的真实状态文字，如 ["Tour confirmations: Off", ...]。 */
  statusLines?: string[];
  busy: boolean;
  error: string;
  confirming: boolean;
  timeEditor?: TimeEditor;
  onToggle: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 开 = 绿（表示在发），关 = 灰；不用蓝色（蓝色只给提交键）。 */
function Switch({
  checked,
  label,
  disabled,
  onClick,
}: {
  checked: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative h-[21px] w-[38px] shrink-0 rounded-full border disabled:cursor-not-allowed disabled:opacity-45",
        "after:absolute after:top-0.5 after:left-0.5 after:size-[15px] after:rounded-full after:transition-transform",
        checked
          ? "border-[#4ade80] bg-[#4ade80]/[.28] after:translate-x-[17px] after:bg-[#4ade80]"
          : "cursor-pointer border-white/35 bg-white/10 after:bg-[#cbd5e1]",
      )}
    />
  );
}

export function NotificationCard({
  item,
  on,
  statusLines,
  busy,
  error,
  confirming,
  timeEditor,
  onToggle,
  onConfirm,
  onCancel,
}: CardProps) {
  const managed = item.managed_elsewhere === true;
  const notWired = item.wired === false;
  const canEdit = !managed && !notWired && item.can_edit === true;
  const sample = normalizeSample(item.sample);
  const since = on && !managed ? formatSince(item.enabled_at) : "";
  const [time, setTime] = useState(timeEditor?.saved ?? "");
  // 服务器返回的时间变了（存好后），输入框跟着回到已存的值。
  const [lastSaved, setLastSaved] = useState(timeEditor?.saved ?? "");
  if (timeEditor && timeEditor.saved !== lastSaved) {
    setLastSaved(timeEditor.saved);
    setTime(timeEditor.saved);
  }

  return (
    <div
      data-notification={item.key}
      data-on={on || undefined}
      className={cn(
        "mb-2.5 rounded-[16px] border bg-[#0b1a2c] px-4 py-3.5",
        on ? "border-[#4ade80]/45" : "border-white/[.14]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="m-0 min-w-0 flex-[1_1_260px] text-[15px] font-bold">
          {item.label}
        </h3>
        {managed ? (
          <span className="text-xs font-bold whitespace-nowrap text-white/60">
            Managed on the Auto Send page
          </span>
        ) : notWired ? (
          <span
            data-state="not-wired"
            className="text-xs font-bold whitespace-nowrap text-white/60"
          >
            Not connected yet
          </span>
        ) : (
          <>
            <span
              data-state={on ? "on" : "off"}
              className={cn(
                "text-xs font-bold whitespace-nowrap",
                on ? "text-[#4ade80]" : "text-[#fbbf24]",
              )}
            >
              <span
                aria-hidden
                className="mr-1.5 inline-block size-2 rounded-full bg-current"
              />
              {on ? `On${since ? ` since ${since}` : ""}` : "Off"}
            </span>
            <Switch
              checked={on}
              label={item.label}
              disabled={!canEdit || busy}
              onClick={onToggle}
            />
          </>
        )}
      </div>

      {item.description ? (
        <p className="mt-1.5 max-w-[78ch] text-[13.5px] text-[#dbe4ee]">
          {item.description}
        </p>
      ) : null}

      {managed ? (
        <p className="mt-1.5 text-xs text-white/60">
          Right now —{" "}
          {statusLines && statusLines.length
            ? statusLines.join(" · ")
            : "status unavailable"}{" "}
          ·{" "}
          <PageLink
            href="/settings/auto-send"
            className="text-[12.5px] text-[#f8fafc] underline underline-offset-[3px]"
          >
            Open Settings → Auto Send →
          </PageLink>
        </p>
      ) : !canEdit && !notWired ? (
        <p className="mt-1.5 text-xs text-white/60">
          {item.key === SCHEDULE_CONFIRM_KEY
            ? "Only a Super Admin can change this one."
            : "You can’t change this one."}
        </p>
      ) : null}

      {timeEditor ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
          <label className="inline-flex items-center gap-2">
            Send time on Wednesdays
            <input
              type="time"
              value={time}
              disabled={!canEdit || timeEditor.saving}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-lg border border-white/20 bg-black/[.28] px-2 py-1 text-[13px] text-[#f8fafc] [color-scheme:dark] disabled:opacity-60"
            />
          </label>
          <span className="text-xs text-white/60">Los Angeles time</span>
          {canEdit && time && time !== timeEditor.saved ? (
            <button
              type="button"
              disabled={timeEditor.saving}
              onClick={() => timeEditor.onSave(time)}
              className="rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 py-1.5 text-[13px] font-bold text-white hover:bg-[#2f76e8] disabled:opacity-60"
            >
              {timeEditor.saving ? "Saving…" : "Save time"}
            </button>
          ) : null}
        </div>
      ) : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-label={`Turn on ${item.label}`}
          className="mt-2.5 flex flex-col gap-2 rounded-xl border border-[#fbbf24]/50 bg-[#fbbf24]/[.07] px-3 py-2.5 text-[13px]"
        >
          <b>Turn on “{item.label}”?</b>
          {confirmText(item.key).map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 py-1.5 text-[13px] font-bold text-white hover:bg-[#2f76e8] disabled:opacity-60"
            >
              {busy ? "Turning on…" : "Turn on"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-[9px] border border-white/30 px-3.5 py-1.5 text-[13px] hover:bg-white/[.08] disabled:opacity-60"
            >
              Cancel
            </button>
          </span>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}

      <details className="mt-2">
        <summary className="w-max cursor-pointer text-[12.5px] text-white/60 hover:text-white">
          Details
        </summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-3.5 gap-y-0.5 text-[13px] sm:grid-cols-[110px_1fr] sm:gap-y-2">
          {item.trigger ? <Fact term="When">{item.trigger}</Fact> : null}
          {item.recipients ? (
            <Fact term="Who gets it">{item.recipients}</Fact>
          ) : null}
          {sample ? (
            <Fact term="Sample">
              <div className="rounded-[10px] border border-dashed border-white/25 bg-white/[.03] px-3 py-2 text-[12.5px] whitespace-pre-line">
                {sample.subject ? (
                  <span className="mb-1 block font-mono text-xs text-[#7dd3fc]">
                    {sample.subject}
                  </span>
                ) : null}
                {sample.body}
              </div>
            </Fact>
          ) : null}
        </dl>
      </details>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-xs font-semibold tracking-[.05em] text-white/40 uppercase">
        {term}
      </dt>
      <dd className="m-0 mb-2 min-w-0 sm:mb-0">{children}</dd>
    </>
  );
}
