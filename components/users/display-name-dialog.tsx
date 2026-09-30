"use client";

import { useId, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import type { AdminUser } from "@/types";

import { DISPLAY_NAME_MAX_LENGTH, displayNameOf } from "./config";

interface DisplayNameDialogProps {
  user: AdminUser;
  onSubmit: (displayName: string) => Promise<ActionResult>;
  onClose: () => void;
}

export function DisplayNameDialog({
  user,
  onSubmit,
  onClose,
}: DisplayNameDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const [name, setName] = useState(displayNameOf(user));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Display name cannot be empty.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSubmit(trimmed);
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
    }
  }

  return (
    <Modal titleId={titleId} onDismiss={saving ? undefined : onClose}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold text-stone-900">
            Edit Display Name
          </h2>
          <p className="text-sm text-stone-500">
            This name is shown in the admin UI. Initials (
            {user.initials?.trim() || "—"}) are used as the signature on all
            actions and are not changed here.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-stone-700"
          >
            Display Name *
          </label>
          <input
            id={inputId}
            type="text"
            autoFocus
            autoComplete="off"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[#A32D2D]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={PRIMARY_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
