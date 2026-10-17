"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";

/** 表上按天改（G81）两个弹框共用的深色外壳：样子同 CellEditor（Esc / 点背景关闭，保存中不能关）。 */
export function DayDialog({
  title,
  subtitle,
  error,
  saving,
  canSave,
  children,
  onSave,
  onClose,
}: {
  title: string;
  subtitle: string;
  error: string | null;
  saving: boolean;
  canSave: boolean;
  children: ReactNode;
  onSave: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const pressedOnBackdropRef = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

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

        {children}

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
            disabled={saving || !canSave}
            onClick={onSave}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const DAY_INPUT_CLASS =
  "w-full rounded-md border border-white/15 bg-white/[.06] px-2 py-1.5 text-sm text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none disabled:opacity-50";
