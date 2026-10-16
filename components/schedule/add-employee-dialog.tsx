"use client";

import { useId, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { ScheduleEmployeeInput } from "@/types";

import { INPUT, PRIMARY_BTN, SECONDARY_BTN } from "./config";

interface AddEmployeeDialogProps {
  onSubmit: (input: ScheduleEmployeeInput) => Promise<ActionResult>;
  onClose: () => void;
}

export function AddEmployeeDialog({
  onSubmit,
  onClose,
}: AddEmployeeDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const emailId = useId();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : onClose}
      panelClassName="max-w-[380px] rounded-[14px] border border-white/10 bg-[#0b1724] p-6 text-white/90"
    >
      <form noValidate onSubmit={handleSubmit}>
        <h2 id={titleId} className="mb-4 text-[16px] font-semibold text-white">
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
            className={SECONDARY_BTN}
          >
            Cancel
          </button>
          <button type="submit" disabled={saving} className={PRIMARY_BTN}>
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
