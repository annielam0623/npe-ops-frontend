"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";

/** 手写格子最多几个字（后端同样拦，≤500）。 */
export const CELL_MAX_LENGTH = 500;

/**
 * 手写格子（G63：Crew notes、Pax、Driver / Vehicle type、CCL major events、Day Tour Live Link）的编辑框。
 * 样子和交互同 GuideEditor（深色居中弹框，Esc / 点背景关闭，保存中不能关）。
 * 写空再 Save = 删掉（后端约定）。出错照后端原话写在框里，框不关、字不丢。
 */
export function CellEditor({
  title,
  subtitle,
  initialValue,
  multiline,
  placeholder,
  hint,
  onSave,
  onClose,
}: {
  title: string;
  subtitle: string;
  initialValue: string;
  multiline: boolean;
  placeholder?: string;
  hint: string;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const inputId = useId();
  const pressedOnBackdropRef = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value.trim());
      onClose();
    } catch (e) {
      setError(describeError(e));
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-white/15 bg-white/[.06] px-2 py-1.5 text-sm text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none disabled:opacity-50";

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
          !saving
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
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-white/50">{subtitle}</p>

        <label htmlFor={inputId} className="sr-only">
          {title}
        </label>
        {multiline ? (
          <textarea
            id={inputId}
            rows={3}
            autoFocus
            value={value}
            maxLength={CELL_MAX_LENGTH}
            disabled={saving}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            className={`mt-3 ${inputClass}`}
          />
        ) : (
          <input
            id={inputId}
            type="text"
            autoFocus
            value={value}
            maxLength={CELL_MAX_LENGTH}
            disabled={saving}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSave();
              }
            }}
            className={`mt-3 ${inputClass}`}
          />
        )}
        <p className="mt-1 text-[11px] text-white/45">{hint}</p>

        {error ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className={DARK_SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
