"use client";

import { useId, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import {
  LEGACY_CANCEL_BUTTON_CLASS,
  LEGACY_ERROR_CLASS,
  LEGACY_SAVE_BUTTON_CLASS,
} from "@/components/teams/legacy-styles";
import { ModalCloseButton } from "@/components/users/modal-close-button";
import type { Duty, TeamMemberContact } from "@/types";

/** 部门邮箱（reservations@）那一行：只有职责可以改。 */
export function ContactDutiesDialog({
  contact,
  duties,
  onSubmit,
  onClose,
}: {
  contact: TeamMemberContact;
  duties: Duty[];
  onSubmit: (codes: string[]) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const titleId = useId();
  const [selected, setSelected] = useState(() => new Set(contact.duties));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSubmit(
      duties.filter((d) => selected.has(d.code)).map((d) => d.code),
    );
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
    }
  }

  return (
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : onClose}
      panelClassName="relative max-w-[520px] !rounded-[14px] p-7 !shadow-[0_20px_60px_rgba(0,0,0,.2)] text-[#1a1a2e]"
    >
      <ModalCloseButton onClick={onClose} disabled={saving} />
      <form noValidate onSubmit={handleSubmit}>
        <h2 id={titleId} className="m-0 text-[18px] font-bold text-[#1a1a1a]">
          {contact.name} mailbox
        </h2>
        <p className="m-0 mt-1 mb-5 text-[12.5px] break-all text-[#4b5563]">
          {contact.email} · Department mailbox
        </p>
        <h3 className="m-0 mb-2 text-[14px] font-bold text-[#1a1a1a]">
          Notification duties
        </h3>
        <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-[18px] gap-y-1.5">
          {duties.map((duty) => (
            <label
              key={duty.code}
              className="flex cursor-pointer items-center gap-2 text-[13px]"
            >
              <input
                type="checkbox"
                checked={selected.has(duty.code)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) {
                      next.add(duty.code);
                    } else {
                      next.delete(duty.code);
                    }
                    return next;
                  })
                }
              />
              {duty.display_name}
            </label>
          ))}
        </div>
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
