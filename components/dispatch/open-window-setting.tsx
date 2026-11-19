"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchOpenTodayWindow,
  type OpenTodayWindow,
  saveOpenTodayWindow,
} from "@/lib/dispatch-open-today-api";

/**
 * 147 第二部分（Annie「dispatch的问题全部同意推荐，动手」，preview https://claude.ai/artifact/4r34eUEnzLb23iE1EF9zmf 三题全 A）：
 * Dispatch 页头 Super Admin 才有的链接「Open shift opens today ⚙」，点了出弹窗改时间段。
 * 读不到（不是 Super Admin 403 / 旧后端 404 / 出错）⇒ 不出链接。时间框可选到任意一分钟，不跨午夜。
 */
export function useOpenTodayWindow(enabled: boolean): {
  window: OpenTodayWindow | null;
  setWindow: (w: OpenTodayWindow) => void;
} {
  const [win, setWin] = useState<OpenTodayWindow | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    fetchOpenTodayWindow(ac.signal).then(
      (w) => {
        if (w && typeof w.start === "string" && typeof w.end === "string")
          setWin(w);
      },
      () => {
        // 403 / 404 / 出错 ⇒ 不出链接。
      },
    );
    return () => ac.abort();
  }, [enabled]);
  return { window: win, setWindow: setWin };
}

const TITLE = "Open shift opens today";

export function OpenWindowLink({
  value,
  onSaved,
  onUnauthorized,
}: {
  value: OpenTodayWindow;
  onSaved: (w: OpenTodayWindow) => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-open-window-link
        onClick={() => setOpen(true)}
        className="ml-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-[#cbd5e1] underline-offset-2 hover:text-white hover:underline"
      >
        {TITLE} ⚙
      </button>
      {open ? (
        <OpenWindowDialog
          value={value}
          onSaved={onSaved}
          onClose={() => setOpen(false)}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </>
  );
}

function OpenWindowDialog({
  value,
  onSaved,
  onClose,
  onUnauthorized,
}: {
  value: OpenTodayWindow;
  onSaved: (w: OpenTodayWindow) => void;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(value.end);
  const [stored, setStored] = useState(value);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const dirty = start !== stored.start || end !== stored.end;

  function dismiss() {
    if (saving) return;
    if (dirty && !window.confirm("Discard the changes you have not saved?"))
      return;
    onClose();
  }

  async function save() {
    setResult(null);
    if (!start || !end || start >= end) {
      setResult({
        ok: false,
        text: "Start time must be earlier than end time.",
      });
      return;
    }
    setSaving(true);
    try {
      const w = await saveOpenTodayWindow({ start, end });
      setStored(w);
      setStart(w.start);
      setEnd(w.end);
      onSaved(w);
      setResult({ ok: true, text: "Saved" });
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setResult({ ok: false, text: describeError(e) });
    } finally {
      setSaving(false);
    }
  }

  const input =
    "rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-[14px] text-[#0f172a] tabular-nums outline-none focus:border-[#3b82f6]";
  const saved = result?.ok && !dirty;

  return (
    <Modal
      titleId="open-window-title"
      onDismiss={saving ? undefined : dismiss}
      panelClassName="max-w-[460px] overflow-hidden text-[#0f172a]"
    >
      <div data-open-window-dialog>
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-[18px] py-3.5">
          <b id="open-window-title" className="text-[16px]">
            {TITLE}
          </b>
          <button
            type="button"
            aria-label="Close"
            disabled={saving}
            onClick={dismiss}
            className="cursor-pointer border-0 bg-transparent text-[20px] leading-none text-[#64748b]"
          >
            ×
          </button>
        </div>
        <div className="px-[18px] py-3.5">
          <p className="mt-0 mb-3 text-[13.5px] text-[#334155]">
            People on today&rsquo;s Open shift in the published Staff Schedule
            see today when they open Dispatch between these times. Outside these
            times, and for everyone else, the sign-in rule applies.
          </p>
          <div className="flex flex-wrap items-end gap-3.5">
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-[#475569]">
                Start
              </span>
              <input
                type="time"
                data-open-start
                value={start}
                disabled={saving}
                onChange={(e) => {
                  setStart(e.target.value);
                  setResult(null);
                }}
                className={input}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-[#475569]">
                End
              </span>
              <input
                type="time"
                data-open-end
                value={end}
                disabled={saving}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setResult(null);
                }}
                className={input}
              />
            </label>
            <span className="pb-2 text-[12.5px] text-[#64748b]">
              Las Vegas time
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[#e2e8f0] px-[18px] py-3">
          {result ? (
            <span
              role={result.ok ? "status" : "alert"}
              data-open-result
              className={
                result.ok
                  ? "mr-auto text-[13px] font-semibold text-[#15803d]"
                  : "mr-auto text-[13px] font-semibold text-[#b91c1c]"
              }
            >
              {result.text}
            </span>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={dismiss}
            className="cursor-pointer rounded-lg border border-[#cbd5e1] bg-white px-3.5 py-1.5 text-[13.5px] font-semibold text-[#0f172a] disabled:opacity-60"
          >
            {saved ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            data-open-save
            disabled={saving}
            onClick={() => void save()}
            className="cursor-pointer rounded-lg border border-[#3b82f6] bg-[#3b82f6] px-4 py-1.5 text-[13.5px] font-bold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
