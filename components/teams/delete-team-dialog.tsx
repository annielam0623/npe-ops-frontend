"use client";

import { useId, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import type { Team } from "@/types";

import { formatMemberCount } from "./config";
import {
  LEGACY_CANCEL_BUTTON_CLASS,
  LEGACY_DELETE_BUTTON_CLASS,
  LEGACY_ERROR_CLASS,
  LEGACY_MODAL_TITLE_CLASS,
} from "./legacy-styles";

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
    <Modal
      titleId={titleId}
      onDismiss={deleting ? undefined : onClose}
      panelClassName="max-w-[460px] !rounded-[14px] p-7"
    >
      {/* 旧页面用浏览器 confirm()，没有弹窗；样子借用 New / Edit Team 弹窗。 */}
      <div>
        <h2 id={titleId} className={LEGACY_MODAL_TITLE_CLASS}>
          Delete Team
        </h2>
        <p className="mb-5 text-[14px] break-words text-[#444]">
          {describeDeleteConsequences(team)}
        </p>

        {error ? (
          <p role="alert" className={LEGACY_ERROR_CLASS}>
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={deleting}
            className={LEGACY_CANCEL_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className={LEGACY_DELETE_BUTTON_CLASS}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
