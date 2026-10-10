"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActionFailure,
  ActionResult,
} from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DARK_SHELL_CLASS } from "@/components/ui/dark-page";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { copyText } from "@/lib/clipboard";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { fetchTeams } from "@/lib/teams-api";
import {
  buildInviteUrl,
  changeUserRole,
  createInvite,
  deactivateUser,
  deleteUser,
  fetchUsers,
  reactivateUser,
  updateDisplayName,
  updateUserTeams,
} from "@/lib/users-api";
import type { AdminUser, AssignableRole, Team } from "@/types";

import { AssignTeamsDialog } from "./assign-teams-dialog";
import { describeRoleChange, displayNameOf, isPending } from "./config";
import { DisplayNameDialog } from "./display-name-dialog";
import { InviteDialog, type InviteOutcome } from "./invite-dialog";
import { RoleLegend } from "./role-legend";
import { UsersTable } from "./users-table";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      users: AdminUser[];
      teams: Team[];
      /** 只有 superadmin 能改角色（后端 require_superadmin）。 */
      canChangeRoles: boolean;
    };

type DialogState =
  | { kind: "invite"; existingUrl?: string }
  | { kind: "edit-name"; user: AdminUser }
  | { kind: "teams"; user: AdminUser }
  | { kind: "role"; user: AdminUser; role: AssignableRole }
  | { kind: "deactivate"; user: AdminUser }
  | { kind: "delete"; user: AdminUser }
  | null;

/** 用户和团队一起拉：团队列用团队名和颜色显示。 */
async function fetchUsersAndTeams(signal?: AbortSignal) {
  const [users, teams] = await Promise.all([
    fetchUsers(signal),
    fetchTeams(signal),
  ]);
  return { users, teams };
}

export function UsersView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [dialog, setDialog] = useState<DialogState>(null);
  // 不弹框的操作（恢复账号）出错时显示在列表上方。
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  // 递增即重新校验身份并拉取列表（首次加载、Retry）。
  const [reloadKey, setReloadKey] = useState(0);

  const redirectingRef = useRef(false);

  // 与 teams 页一致：401 跳旧后台登录页，next 带上当前页面完整 URL。
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  /** 列表 / 身份请求失败时更新页面状态；401 跳登录，403 显示无权限。 */
  const applyLoadError = useCallback(
    (error: unknown) => {
      if (isStatus(error, 401)) {
        redirectToLogin();
      } else if (isStatus(error, 403)) {
        setView({ kind: "forbidden" });
      } else {
        setView({ kind: "error", message: describeError(error) });
      }
    },
    [redirectToLogin],
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });

    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) {
          return;
        }
        // staff 不去拉列表（后端也会 403）。
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const data = await fetchUsersAndTeams(signal);
        if (!signal.aborted) {
          setView({
            kind: "ready",
            ...data,
            canChangeRoles: me.is_superadmin,
          });
        }
      } catch (error) {
        if (!signal.aborted) {
          applyLoadError(error);
        }
      }
    })();

    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

  /** 操作成功后重新拉列表，不切回整页 Loading，避免列表闪一下。 */
  async function refreshList() {
    try {
      const data = await fetchUsersAndTeams();
      setView((prev) => (prev.kind === "ready" ? { ...prev, ...data } : prev));
    } catch (error) {
      applyLoadError(error);
    }
  }

  function toActionError(error: unknown): ActionFailure {
    if (isStatus(error, 401)) {
      redirectToLogin();
      return { status: "redirecting" };
    }
    return { status: "error", message: describeError(error) };
  }

  /** 弹窗里的操作：成功关弹窗并刷新列表，失败把原因留在弹窗里。 */
  async function runDialogAction(
    action: () => Promise<unknown>,
  ): Promise<ActionResult> {
    try {
      await action();
    } catch (error) {
      return toActionError(error);
    }
    setDialog(null);
    void refreshList();
    return { status: "ok" };
  }

  async function handleGenerateInvite(): Promise<InviteOutcome> {
    let token: string;
    try {
      ({ invite_token: token } = await createInvite());
    } catch (error) {
      return toActionError(error);
    }
    // 新的待注册行立即出现在列表里；弹窗保持打开，显示链接。
    void refreshList();
    return { status: "ok", url: buildInviteUrl(token) };
  }

  async function handleCopyLink(user: AdminUser): Promise<boolean> {
    if (!user.invite_token) {
      return false;
    }
    const url = buildInviteUrl(user.invite_token);
    if (await copyText(url)) {
      return true;
    }
    // 复制不了（非 https、浏览器拒绝）：弹窗显示链接，让用户手动复制。
    setDialog({ kind: "invite", existingUrl: url });
    return false;
  }

  async function handleReactivate(user: AdminUser) {
    if (busyUserId !== null) {
      return;
    }
    setActionError(null);
    setBusyUserId(user.id);
    try {
      await reactivateUser(user.id);
      await refreshList();
    } catch (error) {
      const result = toActionError(error);
      if (result.status === "error") {
        setActionError(
          `Failed to reactivate ${displayNameOf(user)}: ${result.message}`,
        );
      }
    } finally {
      setBusyUserId(null);
    }
  }

  const closeDialog = useCallback(() => setDialog(null), []);

  const teamsById = useMemo(
    () =>
      new Map(
        view.kind === "ready" ? view.teams.map((team) => [team.id, team]) : [],
      ),
    [view],
  );

  return (
    <main className={DARK_SHELL_CLASS}>
      {/* 同旧页面：.content 28px 里再套 padding 28px 32px、max-width 1050px，靠左。 */}
      <div className="flex max-w-[1114px] flex-col gap-5 p-4 sm:px-[60px] sm:py-14">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            {/* 旧模板标题写的是 #1a1a2e，直接落在深色底上看不见（同 Teams 页的判断），改白字。 */}
            <h1 className="m-0 text-[22px] font-bold text-white">Users</h1>
            <p className="mt-1 text-[13px] text-[#6b7280]">
              Manage staff access to NPE Operations.
            </p>
          </div>
          {view.kind === "ready" ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: "invite" })}
              className="cursor-pointer rounded-lg bg-[linear-gradient(135deg,#1a6b3c,#27ae60)] px-5 py-2.5 text-sm font-semibold text-white"
            >
              + Invite Staff
            </button>
          ) : null}
        </header>

        <HowToUse />

        {actionError && view.kind === "ready" ? (
          <ErrorBanner
            dark
            actionLabel="Dismiss"
            onAction={() => setActionError(null)}
          >
            {actionError}
          </ErrorBanner>
        ) : null}

        {view.kind === "loading" ? <Panel dark>Loading...</Panel> : null}

        {view.kind === "forbidden" ? (
          <Panel dark>
            <p className="font-medium text-white/85">Admin access required</p>
            <p className="mt-1">Only admins can manage users.</p>
          </Panel>
        ) : null}

        {view.kind === "error" ? (
          <ErrorBanner
            dark
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Failed to load users: {view.message}
          </ErrorBanner>
        ) : null}

        {view.kind === "ready" ? (
          <>
            {view.users.length === 0 ? (
              <Panel dark>No users yet.</Panel>
            ) : (
              <UsersTable
                users={view.users}
                teamsById={teamsById}
                canChangeRoles={view.canChangeRoles}
                busyUserId={busyUserId}
                onEditName={(user) => setDialog({ kind: "edit-name", user })}
                onAssignTeams={(user) => setDialog({ kind: "teams", user })}
                onChangeRole={(user, role) =>
                  setDialog({ kind: "role", user, role })
                }
                onDeactivate={(user) => setDialog({ kind: "deactivate", user })}
                onReactivate={handleReactivate}
                onDelete={(user) => setDialog({ kind: "delete", user })}
                onCopyLink={handleCopyLink}
              />
            )}
            <RoleLegend />
          </>
        ) : null}
      </div>

      {view.kind === "ready" ? (
        <UsersDialogs
          dialog={dialog}
          teams={view.teams}
          runAction={runDialogAction}
          onGenerateInvite={handleGenerateInvite}
          onClose={closeDialog}
        />
      ) : null}
    </main>
  );
}

/** 照旧页面：不折叠的说明框，文字照抄（按钮名「✏️ Name」「🗑」都是旧页面的写法）。 */
function HowToUse() {
  return (
    <div className="rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3.5 text-xs leading-[1.8] text-[#0c3a6b]">
      <div className="mb-1.5 font-semibold text-[#185FA5]">
        📖 How to use — Users
      </div>
      <ol className="m-0 list-decimal pl-[18px]">
        <li>
          Add a person: click Invite Staff, then Generate Invite Link, then
          Copy, and send the link to them. They pick their own username and
          password when they open it. Until then their row shows Pending; Copy
          Link copies the link again and the bin cancels the invite.
        </li>
        <li>
          Teams: click the team names in a person&rsquo;s row (or + Add), tick
          the teams, then Save. Teams decide which message boards the person
          sees.
        </li>
        <li>
          Name: click ✏️ Name to change how a person&rsquo;s name shows. This
          does not change their initials, which are their signature on actions.
        </li>
        <li>
          Role (Super Admin only): pick a new role in the Role column, then
          click OK. Driver and Guide lose all back-office access.
        </li>
        <li>
          Stop someone logging in: click Deactivate, then OK. They are logged
          out straight away. Reactivate lets them back in. The bin deletes the
          account for good and cannot be undone.
        </li>
      </ol>
      <div className="mt-2 border-t border-[#b5d4f4] pt-2">
        If something does not work, a message tells you and nothing is changed.
      </div>
    </div>
  );
}

function UsersDialogs({
  dialog,
  teams,
  runAction,
  onGenerateInvite,
  onClose,
}: {
  dialog: DialogState;
  teams: Team[];
  runAction: (action: () => Promise<unknown>) => Promise<ActionResult>;
  onGenerateInvite: () => Promise<InviteOutcome>;
  onClose: () => void;
}) {
  switch (dialog?.kind) {
    case undefined:
      return null;

    case "invite":
      return (
        <InviteDialog
          existingUrl={dialog.existingUrl}
          onGenerate={onGenerateInvite}
          onClose={onClose}
        />
      );

    case "edit-name":
      return (
        <DisplayNameDialog
          user={dialog.user}
          onSubmit={(name) =>
            runAction(() => updateDisplayName(dialog.user.id, name))
          }
          onClose={onClose}
        />
      );

    case "teams":
      return (
        <AssignTeamsDialog
          user={dialog.user}
          teams={teams}
          onSubmit={(teamIds) =>
            runAction(() => updateUserTeams(dialog.user.id, teamIds))
          }
          onClose={onClose}
        />
      );

    case "role": {
      const { message, warning } = describeRoleChange(dialog.user, dialog.role);
      return (
        <ConfirmDialog
          title="Change Role"
          confirmLabel="Change Role"
          busyLabel="Saving…"
          danger={warning !== null}
          onConfirm={() =>
            runAction(() => changeUserRole(dialog.user.id, dialog.role))
          }
          onClose={onClose}
        >
          <p>{message}</p>
          {warning ? (
            <p className="rounded-md border border-[#fed7aa] bg-[#fff4e5] px-3 py-2 text-[#9a3412]">
              {warning}
            </p>
          ) : null}
        </ConfirmDialog>
      );
    }

    case "deactivate":
      return (
        <ConfirmDialog
          title="Deactivate User"
          confirmLabel="Deactivate"
          busyLabel="Deactivating…"
          danger
          onConfirm={() => runAction(() => deactivateUser(dialog.user.id))}
          onClose={onClose}
        >
          <p>
            Deactivate {displayNameOf(dialog.user)}? They will be logged out
            immediately and cannot log back in until reactivated.
          </p>
        </ConfirmDialog>
      );

    case "delete":
      return (
        <ConfirmDialog
          title={isPending(dialog.user) ? "Delete Invite" : "Delete User"}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onConfirm={() => runAction(() => deleteUser(dialog.user.id))}
          onClose={onClose}
        >
          <p>
            {isPending(dialog.user)
              ? "Permanently delete this pending invite? The invite link will stop working."
              : `Permanently delete ${displayNameOf(dialog.user)}? This cannot be undone.`}
          </p>
        </ConfirmDialog>
      );
  }
}
