"use client";

import { useId, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import type { AdminUser, Team } from "@/types";

import { displayNameOf, isPending } from "./config";

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
    <Modal titleId={titleId} onDismiss={saving ? undefined : onClose}>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold text-stone-900">
            Assign Teams
          </h2>
          <p className="text-sm break-words text-stone-500">
            {isPending(user) ? "Pending invite" : displayNameOf(user)}
          </p>
        </div>

        {teams.length === 0 ? (
          <p className="rounded-md border border-stone-200 px-4 py-6 text-center text-sm text-stone-500">
            No teams yet. Create one in Settings → Teams first.
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {teams.map((team) => (
              <li key={team.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-stone-200 px-3.5 py-2.5 hover:bg-stone-50">
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
                  <span className="min-w-0 text-sm font-medium break-words text-stone-800">
                    {team.name}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

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
            disabled={saving || teams.length === 0}
            className={PRIMARY_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
