"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActionFailure,
  ActionResult,
} from "@/components/ui/action-result";
import { PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Settings
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">Users</h1>
            <p className="text-sm text-stone-500">
              Manage staff access to NPE Operations
            </p>
          </div>
          {view.kind === "ready" ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: "invite" })}
              className={PRIMARY_BUTTON_CLASS}
            >
              + Invite Staff
            </button>
          ) : null}
        </header>

        {actionError && view.kind === "ready" ? (
          <ErrorBanner
            actionLabel="Dismiss"
            onAction={() => setActionError(null)}
          >
            {actionError}
          </ErrorBanner>
        ) : null}

        {view.kind === "loading" ? <Panel>Loading...</Panel> : null}

        {view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Admin access required</p>
            <p className="mt-1">Only admins can manage users.</p>
          </Panel>
        ) : null}

        {view.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Failed to load users: {view.message}
          </ErrorBanner>
        ) : null}

        {view.kind === "ready" ? (
          <>
            {view.users.length === 0 ? (
              <Panel>No users yet.</Panel>
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
