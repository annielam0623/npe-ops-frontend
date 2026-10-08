"use client";

import { useId, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import {
  LEGACY_CANCEL_BUTTON_CLASS,
  LEGACY_ERROR_CLASS,
  LEGACY_SAVE_BUTTON_CLASS,
} from "@/components/teams/legacy-styles";
import type { AdminUser, Team } from "@/types";

import { displayNameOf, isPending } from "./config";
import { ModalCloseButton } from "./modal-close-button";

interface AssignTeamsDialogProps {
  user: AdminUser;
  teams: Team[];
  onSubmit: (teamIds: number[]) => Promise<ActionResult>;
  onClose: () => void;
}

export function AssignTeamsDialog({
  user,
  teams,
  onSubmit,
  onClose,
}: AssignTeamsDialogProps) {
  const titleId = useId();
  // 已被删除的团队 id 不会出现在列表里；保存时只提交还存在的团队。
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(user.team_ids),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(teamId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSubmit(
      teams.filter((team) => selected.has(team.id)).map((team) => team.id),
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
      panelClassName="relative max-w-[420px] !rounded-[14px] p-7 !shadow-[0_20px_60px_rgba(0,0,0,.2)]"
    >
      {/* 版式照旧页面 settings_users.html 的 #teamsModal。 */}
      <ModalCloseButton onClick={onClose} disabled={saving} />
      <form noValidate onSubmit={handleSubmit}>
        <h2
          id={titleId}
          className="m-0 mb-1 text-[17px] font-bold text-[#1a1a2e]"
        >
          Assign Teams
        </h2>
        <p className="m-0 mb-5 text-[13px] break-words text-[#6b7280]">
          {isPending(user) ? "Pending invite" : displayNameOf(user)}
        </p>

        {teams.length === 0 ? (
          <p className="mb-6 rounded-[8px] border border-[#e5e7eb] px-4 py-6 text-center text-[13px] text-[#6b7280]">
            No teams yet. Create one in Settings → Teams first.
          </p>
        ) : (
          <ul className="mb-6 flex max-h-80 flex-col gap-2.5 overflow-y-auto">
            {teams.map((team) => (
              <li key={team.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-[#e5e7eb] bg-white px-3.5 py-2.5 transition-colors duration-100 hover:bg-[#f9fafb]">
                  <input
                    type="checkbox"
                    checked={selected.has(team.id)}
                    onChange={() => toggle(team.id)}
                    className="size-4 cursor-pointer"
                    style={{ accentColor: team.color }}
                  />
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="min-w-0 text-[14px] font-medium break-words text-[#1a1a2e]">
                    {team.name}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

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
            disabled={saving || teams.length === 0}
            className={LEGACY_SAVE_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
