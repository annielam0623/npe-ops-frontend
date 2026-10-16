"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { cn } from "@/lib/utils";
import type { ScheduleEmployeeInput } from "@/types";

import { INPUT } from "./config";

interface AddEmployeeDialogProps {
  onSubmit: (input: ScheduleEmployeeInput) => Promise<ActionResult>;
  onClose: () => void;
}

// 不走共用 Modal，理由同 cell-editor-dialog.tsx：这页一直是深色，不是靠 night: 切换的。
export function AddEmployeeDialog({
  onSubmit,
  onClose,
}: AddEmployeeDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const emailId = useId();
  const pressedOnBackdropRef = useRef(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSubmit({ name: trimmedName, email: email.trim() });
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
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
        className="w-full max-w-[380px] rounded-xl border border-white/10 bg-[#0d1b2e] p-6 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <form noValidate onSubmit={handleSubmit}>
          <h2
            id={titleId}
            className="mb-4 text-[16px] font-semibold text-white"
          >
            Add employee
          </h2>

          <label
            htmlFor={nameId}
            className="mb-1 block text-[12px] font-medium text-white/75"
          >
            Name *
          </label>
          <input
            id={nameId}
            type="text"
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={cn(INPUT, "mb-3.5 w-full")}
          />

          <label
            htmlFor={emailId}
            className="mb-1 block text-[12px] font-medium text-white/75"
          >
            Email
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="off"
            placeholder="Optional — used for publish notifications"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={cn(INPUT, "mb-4 w-full")}
          />

          {error ? (
            <p role="alert" className="mb-3.5 text-[12px] text-red-300">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={DARK_PRIMARY_BUTTON_CLASS}
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
