"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { DARK_SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

import { TimePicker } from "./time-picker";

/** Done 只把时间放到页面上（不是提交，所以不用蓝色；Annie 2026-10-11 蓝色只给提交键）。 */
const DONE_BUTTON_CLASS =
  "rounded-md border border-white bg-white px-4 py-2 text-sm font-semibold text-[#0b1727] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 改一个班的时间（Annie 2026-10-29 A8「需要在改时间的小页面上设置save，不要再点其他地方，根本点不了」；
 * 后来整周一个 Save（B9 Q1）：小窗的键改叫 Done，只把新时间放到页面上，等整周 Save 一起存）。
 * preview https://claude.ai/artifact/5jHSPfjGt9eD187iP8i2ut Q1–Q4 照推荐：
 * - 在卡片上方弹独立小窗（上面放不下就放下面），写着谁、哪天、什么班；Start / End 并排，时间列表开在小窗里面，不盖键。
 * - 后面一层透明遮罩接住「点外面」：没改过直接关；改过出黄框「Unsaved changes」，键换成 Done / Discard。Esc 同点外面。
 * - 小窗开着时周表上别的格子点不了（被遮罩挡住）。
 */
export function TimeEditPopup({
  anchor,
  title,
  start: initialStart,
  end: initialEnd,
  onDone,
  onClose,
}: {
  /** 被点的那张卡片（量位置用）。 */
  anchor: HTMLElement | null;
  /** 「Jing · Mon 11/2 · Open」。 */
  title: string;
  start: string;
  end: string;
  onDone: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [asking, setAsking] = useState(false);
  const [place, setPlace] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const changed = start !== initialStart || end !== initialEnd;
  const ready = Boolean(start && end);

  // 量卡片的位置：上面有 300px 就从卡片顶上往上长，不然从卡片底下往下长。
  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect();
    if (!r) {
      setPlace({ left: 16, top: 80 });
      return;
    }
    const W = 300;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    setPlace(
      r.top > 300
        ? { left, bottom: window.innerHeight - r.top + 6 }
        : { left, top: r.bottom + 6 },
    );
  }, [anchor]);

  function outside() {
    if (!changed) onClose();
    else setAsking(true);
  }

  function done() {
    if (!ready) return;
    onDone(start, end);
  }

  return (
    <>
      <div
        data-time-popup-backdrop
        className="fixed inset-0 z-[60]"
        onClick={outside}
        aria-hidden
      />
      <div
        ref={boxRef}
        role="dialog"
        aria-label="Change the time"
        data-time-popup
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            outside();
          }
        }}
        style={place ?? { left: 16, top: 80 }}
        className="fixed z-[61] flex w-[300px] flex-col gap-2.5 rounded-[10px] border border-white/25 bg-[#0b1727] p-3 text-white shadow-[0_10px_30px_rgba(0,0,0,.55)]"
      >
        <div className="text-[13px] font-semibold text-white">{title}</div>
        <div className="flex gap-3">
          <div className="flex flex-col gap-1 text-[11.5px] text-white/70">
            Start
            <span className="flex flex-col">
              <TimePicker
                ariaLabel="Start time"
                value={start}
                onChange={(v) => {
                  setStart(v);
                  setAsking(false);
                }}
                inline
              />
            </span>
          </div>
          <div className="flex flex-col gap-1 text-[11.5px] text-white/70">
            End
            <span className="flex flex-col">
              <TimePicker
                ariaLabel="End time"
                value={end}
                onChange={(v) => {
                  setEnd(v);
                  setAsking(false);
                }}
                inline
              />
            </span>
          </div>
        </div>
        {asking ? (
          <div
            data-time-popup-unsaved
            className="rounded-[8px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-3 py-2 text-[12.5px] text-[#fde68a]"
          >
            Unsaved changes. Click Done to put the new time on the schedule, or
            Discard to keep the old one.
          </div>
        ) : null}
        <p className="text-[11px] text-white/55">
          Done puts the new time on the schedule. Click Save at the top to save
          the week.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-time-popup-done
            disabled={!ready}
            onClick={done}
            className={cn(DONE_BUTTON_CLASS, "flex-1")}
          >
            Done
          </button>
          <button
            type="button"
            data-time-popup-cancel
            onClick={onClose}
            className={cn(DARK_SECONDARY_BUTTON_CLASS, "flex-1")}
          >
            {asking ? "Discard" : "Cancel"}
          </button>
        </div>
      </div>
    </>
  );
}
