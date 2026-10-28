"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActionFailure,
  ActionResult,
} from "@/components/ui/action-result";
import { CenteredPage } from "@/components/ui/centered-page";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { AddPersonDialog } from "@/components/team-permissions/add-person-dialog";
import { LegacyHowToBox } from "@/components/teams/legacy-how-to-box";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { copyText } from "@/lib/clipboard";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { fetchTeams } from "@/lib/teams-api";
import {
  buildInviteUrl,
  buildResetUrl,
  changeUserRole,
  createInvite,
  createResetLink,
  deactivateUser,
  deleteUser,
  fetchUsers,
  reactivateUser,
  updateDisplayName,
  updateUserTeams,
} from "@/lib/users-api";
import type { AdminUser, AssignableRole, Team } from "@/types";

import { AssignTeamsDialog } from "./assign-teams-dialog";
import {
  assignableRolesFor,
  describeRoleChange,
  displayNameOf,
  isPending,
  supportsSupervisor,
} from "./config";
import { DisplayNameDialog } from "./display-name-dialog";
import { InviteDialog, type InviteOutcome } from "./invite-dialog";
import { ResetLinkDialog, type ResetOutcome } from "./reset-link-dialog";
import { RoleLegend } from "./role-legend";
import { UsersTable } from "./users-table";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      users: AdminUser[];
      /** null = 读不了团队（403：admin 没勾 settings.users，后端 G177 P3）；页面照常，Teams 列写「—」。 */
      teams: Team[] | null;
      /** 只有 superadmin 能改角色（后端 require_superadmin）。 */
      canChangeRoles: boolean;
      /** 后端已经认 supervisor（`/api/me` 带 `is_supervisor`）。 */
      withSupervisor: boolean;
    };

type DialogState =
  | { kind: "invite"; existingUrl?: string }
  /** Super Admin 点 Invite Staff：开 Team 页那张「Add person」表（能勾权限）。 */
  | { kind: "add-person" }
  | { kind: "edit-name"; user: AdminUser }
  | { kind: "teams"; user: AdminUser }
  | { kind: "role"; user: AdminUser; role: AssignableRole }
  | { kind: "deactivate"; user: AdminUser }
  | { kind: "reset"; user: AdminUser }
  | { kind: "delete"; user: AdminUser }
  | null;

/**
 * 用户和团队一起拉：团队列用团队名和颜色显示。团队那条 403（后端 G177 P3 起挂 settings.users，
 * admin 没勾这一项就读不了）时不算整页失败：teams 为 null，其余照常；401 等别的错照旧往外抛。
 */
async function fetchUsersAndTeams(signal?: AbortSignal) {
  const [users, teams] = await Promise.all([
    fetchUsers(signal),
    fetchTeams(signal).catch((error: unknown) => {
      if (isStatus(error, 403)) return null;
      throw error;
    }),
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
            withSupervisor: supportsSupervisor(me),
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

  const toActionError = useCallback(
    (error: unknown): ActionFailure => {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    },
    [redirectToLogin],
  );

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

  async function handleCreateResetLink(user: AdminUser): Promise<ResetOutcome> {
    try {
      const { reset_token: token } = await createResetLink(user.id);
      return { status: "ok", url: buildResetUrl(token) };
    } catch (error) {
      return toActionError(error);
    }
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
        view.kind === "ready" && view.teams
          ? view.teams.map((team) => [team.id, team])
          : [],
      ),
    [view],
  );

  return (
    // 照旧页面 settings_users.html：内容区 28px 32px、最宽 1050px（不居中）；标题、说明、Invite Staff 在页面里（旧页面没有顶栏标题）。
    <main className="text-stone-800 night:text-white/90">
      <CenteredPage className="flex flex-col py-7 max-lg:px-8">
        <header className="mb-7 flex items-center justify-between gap-3">
          <div>
            {/* 旧页面标题是 #1a1a2e，放在深色底上看不见；按深色底换成旧后台的浅色字。 */}
            <h1 className="m-0 text-[22px] font-bold text-[#f8fafc]">Users</h1>
            <p className="mt-1 text-[13px] text-[#6b7280] night:text-white/55">
              Manage staff access to NPE Operations.
            </p>
          </div>
          {view.kind === "ready" ? (
            <button
              type="button"
              onClick={() =>
                setDialog(
                  view.canChangeRoles
                    ? { kind: "add-person" }
                    : { kind: "invite" },
                )
              }
              className="flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-[linear-gradient(135deg,#1a6b3c,#27ae60)] px-5 py-2.5 text-[14px] font-semibold text-white"
            >
              <span aria-hidden>+</span>
              Invite Staff
            </button>
          ) : null}
        </header>

        {view.kind === "ready" ? <UsersHowTo /> : null}

        {actionError && view.kind === "ready" ? (
          <div className="mb-4">
            <ErrorBanner
              actionLabel="Dismiss"
              onAction={() => setActionError(null)}
            >
              {actionError}
            </ErrorBanner>
          </div>
        ) : null}

        {view.kind === "loading" ? <Panel>Loading...</Panel> : null}

        {view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800 night:text-white/90">
              Admin access required
            </p>
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
                teamsUnavailable={view.teams === null}
                canChangeRoles={view.canChangeRoles}
                roles={assignableRolesFor(view.withSupervisor)}
                busyUserId={busyUserId}
                onEditName={(user) => setDialog({ kind: "edit-name", user })}
                onAssignTeams={(user) => setDialog({ kind: "teams", user })}
                onChangeRole={(user, role) =>
                  setDialog({ kind: "role", user, role })
                }
                onDeactivate={(user) => setDialog({ kind: "deactivate", user })}
                onResetPassword={(user) => setDialog({ kind: "reset", user })}
                onReactivate={handleReactivate}
                onDelete={(user) => setDialog({ kind: "delete", user })}
                onCopyLink={handleCopyLink}
              />
            )}
            <RoleLegend withSupervisor={view.withSupervisor} />
          </>
        ) : null}
      </CenteredPage>

      {view.kind === "ready" ? (
        <UsersDialogs
          dialog={dialog}
          teams={view.teams ?? []}
          runAction={runDialogAction}
          toFailure={toActionError}
          onRefresh={() => void refreshList()}
          onBasicInvite={() => setDialog({ kind: "invite" })}
          onGenerateInvite={handleGenerateInvite}
          onCreateResetLink={handleCreateResetLink}
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
  toFailure,
  onRefresh,
  onBasicInvite,
  onGenerateInvite,
  onCreateResetLink,
  onClose,
}: {
  dialog: DialogState;
  teams: Team[];
  runAction: (action: () => Promise<unknown>) => Promise<ActionResult>;
  toFailure: (error: unknown) => ActionFailure;
  onRefresh: () => void;
  onBasicInvite: () => void;
  onGenerateInvite: () => Promise<InviteOutcome>;
  onCreateResetLink: (user: AdminUser) => Promise<ResetOutcome>;
  onClose: () => void;
}) {
  switch (dialog?.kind) {
    case undefined:
      return null;

    case "add-person":
      return (
        <AddPersonDialog
          onSaved={onRefresh}
          onClose={onClose}
          onBasicInvite={onBasicInvite}
          toFailure={toFailure}
        />
      );

    case "invite":
      return (
        <InviteDialog
          existingUrl={dialog.existingUrl}
          onGenerate={onGenerateInvite}
          onClose={onClose}
        />
      );

    case "reset":
      return (
        <ResetLinkDialog
          key={dialog.user.id}
          user={dialog.user}
          onCreate={() => onCreateResetLink(dialog.user)}
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
          {/* 外勤角色有自己的警告（会失去整个后台），不写这句。 */}
          {warning ? null : (
            <p>
              Their permissions ticked in Settings › Team stay as they are.
            </p>
          )}
          {warning ? (
            <p className="rounded-md border border-[#fed7aa] bg-[#fff4e5] px-3 py-2 text-[#9a3412] night:border-amber-400/30 night:bg-amber-400/10 night:text-amber-200">
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

/** 照旧页面顶部的蓝框说明（常开）；按钮名、确认步骤按 ops 改写。 */
function UsersHowTo() {
  return (
    <LegacyHowToBox
      title="📖 How to use — Users"
      items={[
        "Add a person: click Invite Staff, then Generate Invite Link, then Copy, and send the link to them. They pick their own username and password when they open it. Until then their row shows Pending; Copy Link copies the link again and the bin cancels the invite. Super Admin gets the Add person form instead, where you tick their permissions first.",
        "Teams: click the team names in a person's row (or + Add), tick the teams, then Save. Teams decide which message boards the person sees.",
        "Name: click ✏️ Name to change how a person's name shows. This does not change their initials, which are their signature on actions.",
        "Role (Super Admin only): pick a new role in the Role column, then click Change Role in the box that opens. Changing the role does not change the permissions ticked in Settings › Team. Driver and Guide lose all back-office access. Supervisor works like Staff (no Settings or Users).",
        "Forgot a password: click Reset password, then Create link, then Copy link, and send the link to the person yourself. It is shown only once and works once, for 24 hours. A new link cancels the earlier one.",
        "Stop someone logging in: click Deactivate, then Deactivate in the box that opens. They are logged out straight away. Reactivate lets them back in. The bin deletes the account for good and cannot be undone.",
      ]}
      footer="If something does not work, a message tells you and nothing is changed."
    />
  );
}
