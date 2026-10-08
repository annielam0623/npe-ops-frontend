"use client";

import { useId, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import {
  LEGACY_CANCEL_BUTTON_CLASS,
  LEGACY_ERROR_CLASS,
  LEGACY_INPUT_CLASS,
  LEGACY_LABEL_CLASS,
  LEGACY_SAVE_BUTTON_CLASS,
} from "@/components/teams/legacy-styles";
import type { AdminUser } from "@/types";

import { DISPLAY_NAME_MAX_LENGTH, displayNameOf } from "./config";
import { ModalCloseButton } from "./modal-close-button";

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
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : onClose}
      panelClassName="relative max-w-[400px] !rounded-[14px] p-7 !shadow-[0_20px_60px_rgba(0,0,0,.2)]"
    >
      {/* 版式照旧页面 settings_users.html 的 #editModal。 */}
      <ModalCloseButton onClick={onClose} disabled={saving} />
      <form noValidate onSubmit={handleSubmit}>
        <h2
          id={titleId}
          className="m-0 mb-1.5 text-[17px] font-bold text-[#1a1a2e]"
        >
          Edit Display Name
        </h2>
        <p className="m-0 mb-5 text-[13px] text-[#6b7280]">
          This name is shown in the admin UI. Initials (
          {user.initials?.trim() || "—"}) are used as the signature on all
          actions and are not changed here.
        </p>

        <label htmlFor={inputId} className={LEGACY_LABEL_CLASS}>
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
          className={LEGACY_INPUT_CLASS}
        />

        {error ? (
          <p role="alert" className={LEGACY_ERROR_CLASS}>
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={LEGACY_CANCEL_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={LEGACY_SAVE_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
