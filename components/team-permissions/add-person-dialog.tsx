"use client";

import { useEffect, useId, useState } from "react";

import type { ActionFailure } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import { LEGACY_CANCEL_BUTTON_CLASS } from "@/components/teams/legacy-styles";
import { ModalCloseButton } from "@/components/users/modal-close-button";
import { fetchTeamCatalog, fetchTeamMembers } from "@/lib/team-permissions-api";
import type { TeamCatalog, TeamMemberUser } from "@/types";

import { MemberFormDialog } from "./member-form-dialog";

/**
 * Users 页 Super Admin 点「Invite Staff」：先拿 Team 页的清单，再开同一张「Add person」表。
 * 拿不到（Team 接口出错）时给一个退路：用原来的邀请弹窗（新人拿默认那组权限）。
 */
export function AddPersonDialog({
  onSaved,
  onClose,
  onBasicInvite,
  toFailure,
}: {
  onSaved: () => void;
  onClose: () => void;
  onBasicInvite: () => void;
  toFailure: (error: unknown) => ActionFailure;
}) {
  const titleId = useId();
  const [data, setData] = useState<{
    catalog: TeamCatalog;
    members: TeamMemberUser[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([fetchTeamCatalog(signal), fetchTeamMembers(signal)])
      .then(([catalog, members]) => {
        if (!signal.aborted) {
          setData({
            catalog,
            members: members.filter(
              (m): m is TeamMemberUser => m.kind === "user",
            ),
          });
        }
      })
      .catch((err) => {
        if (!signal.aborted) {
          const failure = toFailure(err);
          if (failure.status === "error") {
            setError(failure.message);
          }
        }
      });
    return () => controller.abort();
  }, [toFailure]);

  if (data) {
    return (
      <MemberFormDialog
        mode={{ kind: "add" }}
        catalog={data.catalog}
        members={data.members}
        onSaved={onSaved}
        onClose={onClose}
        toFailure={toFailure}
      />
    );
  }

  return (
    <Modal
      titleId={titleId}
      onDismiss={onClose}
      panelClassName="relative max-w-[480px] !rounded-[14px] p-7 !shadow-[0_20px_60px_rgba(0,0,0,.2)] text-[#1a1a2e]"
    >
      <ModalCloseButton onClick={onClose} />
      <h2
        id={titleId}
        className="m-0 mb-3 text-[18px] font-bold text-[#1a1a1a]"
      >
        Add person
      </h2>
      {error ? (
        <>
          <p role="alert" className="m-0 mb-5 text-[13px] text-[#c0392b]">
            Could not load the permission list: {error}
          </p>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onBasicInvite}
              className={LEGACY_CANCEL_BUTTON_CLASS}
            >
              Use the basic invite
            </button>
          </div>
        </>
      ) : (
        <p className="m-0 text-[13px] text-[#4b5563]">Loading…</p>
      )}
    </Modal>
  );
}
