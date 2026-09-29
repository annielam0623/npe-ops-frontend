"use client";

import { useId, useState } from "react";

import type { Team } from "@/types";

import { DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";
import { formatMemberCount, type ActionResult } from "./config";
import { Modal } from "./modal";

interface DeleteTeamDialogProps {
  team: Team;
  onConfirm: () => Promise<ActionResult>;
  onClose: () => void;
}

/**
 * 删除的后果旧页面没有告诉操作员，这里写明：
 * user_teams 级联删除 → 成员全部退出该团队；留言板消息保留，但 team_id 被清空。
 */
export function describeDeleteConsequences(team: Team): string {
  const members =
    team.member_count === 0
      ? "It has no members."
      : `Its ${formatMemberCount(team.member_count)} will be removed from the team.`;
  return `Delete team "${team.name}"? ${members} Board messages are kept but lose their team.`;
}

export function DeleteTeamDialog({
  team,
  onConfirm,
  onClose,
}: DeleteTeamDialogProps) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    if (deleting) {
      return;
    }
    setError(null);
    setDeleting(true);
    const result = await onConfirm();
    if (result.status === "error") {
      setError(result.message);
      setDeleting(false);
    }
  }

  return (
    <Modal titleId={titleId} onDismiss={deleting ? undefined : onClose}>
      <div className="flex flex-col gap-4">
        <h2 id={titleId} className="text-lg font-semibold text-stone-900">
          Delete Team
        </h2>
        <p className="text-sm break-words text-stone-700">
          {describeDeleteConsequences(team)}
        </p>

        {error ? (
          <p role="alert" className="text-sm text-[#A32D2D]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={deleting}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className={DANGER_BUTTON_CLASS}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
