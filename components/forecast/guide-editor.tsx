"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";
import type { ForecastGuideOption, ForecastPlanGuide } from "@/types";

import { formatLongDate } from "./config";

/**
 * 点一个 plan 来源的 Driver / Guide 格子弹出的编辑框：当前排的导游（各自可 Remove）+
 * 文本框（datalist 选已有候选人或手打新名字）+ Add guide + Close。
 * 这页是全新功能、旧后台没有对应实现（CLAUDE.md：没有旧页面可比对时照本项目已定的深色风格做），
 * 所以没有沿用共用的白底 Modal（那份是给照抄旧模板白底弹窗的页面用的），自己写一个深色版的居中弹框，
 * 交互（Esc / 点背景关闭、进行中禁止关闭）照抄 components/ui/modal.tsx 的做法。
 */
export function GuideEditor({
  blockName,
  date,
  guides,
  guideOptions,
  onAdd,
  onRemove,
  onClose,
}: {
  blockName: string;
  date: string;
  guides: ForecastPlanGuide[];
  guideOptions: ForecastGuideOption[];
  onAdd: (candidate: { hrId?: number; name?: string }) => Promise<void>;
  onRemove: (guideId: number) => Promise<void>;
  onClose: () => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const listId = useId();
  const pressedOnBackdropRef = useRef(false);
  const busy = adding || removingId !== null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed || busy) return;
    const match = guideOptions.find(
      (g) => g.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    setAdding(true);
    setError(null);
    try {
      await onAdd(match ? { hrId: match.id } : { name: trimmed });
      setInputValue("");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number) {
    if (busy) return;
    setRemovingId(id);
    setError(null);
    try {
      await onRemove(id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedOnBackdropRef.current &&
          event.target === event.currentTarget &&
          !busy
        ) {
          onClose();
        }
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0d1b2e] p-5 text-sm text-white shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <h2 id={titleId} className="text-sm font-semibold text-white">
          {blockName}
        </h2>
        <p className="mt-0.5 text-xs text-white/50">{formatLongDate(date)}</p>

        <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
          {guides.length === 0 ? (
            <li className="text-xs text-white/40">No guide planned yet.</li>
          ) : (
            guides.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[.04] px-2.5 py-1.5"
              >
                <span>{g.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemove(g.id)}
                  className="rounded-md border border-white/15 px-2 py-0.5 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {removingId === g.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="mt-3 flex gap-2">
          <input
            list={listId}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleAdd();
              }
            }}
            placeholder="Pick or type a name"
            disabled={busy}
            aria-label="Guide name"
            className="h-8 min-w-0 flex-1 rounded-md border border-white/15 bg-white/[.06] px-2 text-sm text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none disabled:opacity-50"
          />
          <datalist id={listId}>
            {guideOptions.map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
          <button
            type="button"
            disabled={busy || !inputValue.trim()}
            onClick={() => void handleAdd()}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {adding ? "Adding…" : "Add guide"}
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={DARK_SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
