"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActionFailure,
  ActionResult,
} from "@/components/ui/action-result";
import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { CenteredPage } from "@/components/ui/centered-page";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { AddPersonDialog } from "@/components/team-permissions/add-person-dialog";
import {
  buildAccessGroups,
  summarize,
  type AccessSummary,
} from "@/components/team-permissions/access";
import { homeLabel } from "@/components/team-permissions/config";
import { ContactDutiesDialog } from "@/components/team-permissions/contact-duties-dialog";
import {
  MemberFormDialog,
  type MemberFormMode,
} from "@/components/team-permissions/member-form-dialog";
import { fetchActionLog } from "@/lib/action-log";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { copyText } from "@/lib/clipboard";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  fetchTeamCatalog,
  fetchTeamMember,
  fetchTeamMembers,
  saveContactDuties,
} from "@/lib/team-permissions-api";
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
import { cn } from "@/lib/utils";
import type {
  AdminUser,
  AssignableRole,
  Team,
  TeamCatalog,
  TeamMember,
  TeamMemberContact,
  TeamMemberDetail,
  TeamMemberUser,
} from "@/types";

import { AssignTeamsDialog } from "./assign-teams-dialog";
import {
  assignableRolesFor,
  describeRoleChange,
  displayNameOf,
  isPartner,
  isPending,
  normalizeRole,
  supportsSupervisor,
} from "./config";
import { DeletePersonDialog } from "./delete-person-dialog";
import { DisplayNameDialog } from "./display-name-dialog";
import { InviteDialog, type InviteOutcome } from "./invite-dialog";
import { ResetLinkDialog, type ResetOutcome } from "./reset-link-dialog";
import { RoleLegend } from "./role-legend";
import { UsersTable, type RowExtras } from "./users-table";

/** Super Admin 才读的 /api/team 那一份（权限、职责、首页、部门邮箱）。 */
interface TeamData {
  catalog: TeamCatalog;
  members: TeamMember[];
  /** 各人的完整勾选：列表只给条数，Access 列要按档位算。没拿到的人不在里面。 */
  details: ReadonlyMap<number, TeamMemberDetail>;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      users: AdminUser[];
      /** null = 读不了团队（403：admin 没勾 settings.users，后端 G177 P3）；页面照常，Teams 列写「—」。 */
      teams: Team[] | null;
      /** Super Admin：能改角色、能看 / 改权限、能彻底删除账号。 */
      isSuperAdmin: boolean;
      /** 后端已经认 supervisor（`/api/me` 带 `is_supervisor`）。 */
      withSupervisor: boolean;
      /** Super Admin 的权限那一份；读不到时为 null，原因在 teamError（名单照常）。 */
      team: TeamData | null;
      teamError: string | null;
    };

type DialogState =
  | { kind: "invite"; existingUrl?: string }
  /** Super Admin 点 Add person：开那张能勾权限的表。 */
  | { kind: "add-person" }
  | { kind: "edit-name"; user: AdminUser }
  | { kind: "teams"; user: AdminUser }
  | { kind: "role"; user: AdminUser; role: AssignableRole }
  | { kind: "deactivate"; user: AdminUser }
  | { kind: "reset"; user: AdminUser }
  /** 取消待接受的邀请（行上的 🗑）。 */
  | { kind: "delete"; user: AdminUser }
  | { kind: "member"; mode: MemberFormMode }
  | { kind: "contact"; contact: TeamMemberContact }
  /** Edit 框最下面的 Delete 点了：小确认框；Cancel 回到 Edit 框。 */
  | { kind: "delete-person"; user: AdminUser; member: TeamMemberUser }
  | null;

/** 「Show」下拉：只看某一类（人多了好找）。 */
type ShowFilter = "all" | "active" | "pending" | "inactive" | "partners";
const SHOW_OPTIONS: readonly { value: ShowFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending invites" },
  { value: "inactive", label: "Inactive" },
  { value: "partners", label: "Partners" },
];

/** 一次最多同时请求几个人的详情（约 28 个账号）。 */
const DETAIL_CONCURRENCY = 6;

async function fetchDetails(members: TeamMember[], signal?: AbortSignal) {
  const ids = members
    .filter((m) => m.kind === "user" && !m.is_superadmin)
    .map((m) => m.id);
  const details = new Map<number, TeamMemberDetail>();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        details.set(id, await fetchTeamMember(id, signal));
      } catch (error) {
        // 401 / 403 要整份处理；单个人拿不到只让那一行的 Access 写「—」。
        if (isStatus(error, 401) || isStatus(error, 403) || signal?.aborted) {
          throw error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
  return details;
}

async function fetchTeamData(signal?: AbortSignal): Promise<TeamData> {
  const [catalog, members] = await Promise.all([
    fetchTeamCatalog(signal),
    fetchTeamMembers(signal),
  ]);
  const details = await fetchDetails(members, signal);
  return { catalog, members, details };
}

/**
 * 用户和团队一起拉：团队列用团队名和颜色显示。团队那条 403（后端 G177 P3 起挂 settings.users，
 * admin 没勾这一项就读不了）时不算整页失败：teams 为 null，其余照常；401 等别的错照旧往外抛。
 * Super Admin 再拉权限那一份；它出错（401 除外）只在表上方写一句，名单和 Users 的操作照常。
 */
async function fetchPage(isSuperAdmin: boolean, signal?: AbortSignal) {
  const [users, teams, team] = await Promise.all([
    fetchUsers(signal),
    fetchTeams(signal).catch((error: unknown) => {
      if (isStatus(error, 403)) return null;
      throw error;
    }),
    isSuperAdmin
      ? fetchTeamData(signal).then(
          (data) => ({ data, error: null }),
          (error: unknown) => {
            if (isStatus(error, 401) || signal?.aborted) throw error;
            return { data: null, error: describeError(error) };
          },
        )
      : Promise.resolve({ data: null, error: null }),
  ]);
  return { users, teams, team: team.data, teamError: team.error };
}

/**
 * Settings › Team：原来的 Users 和 Team 两页并成一页（Annie 2026-10-28：「现在user和team的页面根本就是重复的」，
 * preview https://claude.ai/artifact/QpiQpo6x2b82CxAw86W9zq v3「动手」）。
 * - 名单一律从 /api/users 读（Users 的角色、状态、邀请人、加入日期和操作）；Super Admin 再把 /api/team 的
 *   Access / 职责 / 首页 / Edit 和部门邮箱并进来。
 * - admin 能做的照原来 Users 页；看不到 Super Admin 的行（Annie Qa「看不到」）。
 *   Access 这几列等后端按层级开放再给 admin（第二步）。
 * - 彻底删除账号只给 Super Admin，在 Edit 框最下面。
 */
export function TeamView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [dialog, setDialog] = useState<DialogState>(null);
  // 不弹框的操作（恢复账号）出错时显示在列表上方。
  const [actionError, setActionError] = useState<string | null>(null);
  // 删除 / 停用成功后的一句绿字。
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<ShowFilter>("all");
  // 递增即重新校验身份并拉取列表（首次加载、Retry）。
  const [reloadKey, setReloadKey] = useState(0);
  // 递增即让开着的 Action Log 重拉第一页（停用 / 改角色 / 重置链接等成功之后，新的那条马上出来）。
  const [logVersion, setLogVersion] = useState(0);

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
        const data = await fetchPage(me.is_superadmin, signal);
        if (!signal.aborted) {
          setView({
            kind: "ready",
            ...data,
            isSuperAdmin: me.is_superadmin,
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

  const isSuperAdmin = view.kind === "ready" && view.isSuperAdmin;

  /** 操作成功后重新拉列表，不切回整页 Loading，避免列表闪一下。 */
  const refreshList = useCallback(async () => {
    // 调到这里的都是刚做成的操作：日志里已经有新的一条。
    setLogVersion((v) => v + 1);
    try {
      const data = await fetchPage(isSuperAdmin);
      setView((prev) => (prev.kind === "ready" ? { ...prev, ...data } : prev));
    } catch (error) {
      applyLoadError(error);
    }
  }, [isSuperAdmin, applyLoadError]);

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
    done?: string,
  ): Promise<ActionResult> {
    try {
      await action();
    } catch (error) {
      return toActionError(error);
    }
    setDialog(null);
    setNotice(done ?? null);
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
      setLogVersion((v) => v + 1);
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

  async function handleContactDuties(
    contact: TeamMemberContact,
    duties: string[],
  ): Promise<ActionResult> {
    return runDialogAction(() => saveContactDuties(contact.id, duties));
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

  /** Super Admin 的权限那一份按 id 查：档位合计、Team 那边的人、职责名。 */
  const lookups = useMemo(() => {
    if (view.kind !== "ready" || !view.team) {
      return null;
    }
    const { catalog, members, details } = view.team;
    const groups = buildAccessGroups(catalog.modules);
    const summaries = new Map<number, AccessSummary>();
    for (const [id, detail] of details) {
      summaries.set(id, summarize(groups, new Set(detail.items)));
    }
    const memberUsers = members.filter(
      (m): m is TeamMemberUser => m.kind === "user",
    );
    return {
      summaries,
      memberUsers,
      membersById: new Map(memberUsers.map((m) => [m.id, m])),
      contacts: members.filter(
        (m): m is TeamMemberContact => m.kind === "dept_contact",
      ),
      dutiesByCode: new Map(catalog.duties.map((d) => [d.code, d])),
    };
  }, [view]);

  const dutyNames = useCallback(
    (codes: string[]) =>
      codes.length && lookups
        ? codes
            .map((c) => lookups.dutiesByCode.get(c)?.display_name ?? c)
            .join(", ")
        : null,
    [lookups],
  );

  const extras = useMemo(() => {
    if (!lookups) {
      return undefined;
    }
    const map = new Map<number, RowExtras>();
    for (const m of lookups.memberUsers) {
      const summary = lookups.summaries.get(m.id);
      map.set(m.id, {
        access: m.is_superadmin ? (
          "All modules"
        ) : summary ? (
          // 计数用普通文字（不是胶囊、不用蓝色，Annie 2026-10-11）。
          <>
            {summary.modules} modules
            {summary.readOnly ? (
              <span className="block text-[12px] text-[#9ca3af]">
                {summary.readOnly} read only
              </span>
            ) : null}
            {/* 迁移后的勾选和档位对不上的（原样保留），琥珀色提示。 */}
            {summary.custom ? (
              <span className="mt-0.5 inline-block rounded-[6px] border border-[#fcd34d] bg-[#fef3c7] px-[7px] py-px text-[11.5px] font-semibold text-[#92400e]">
                {summary.custom} custom
              </span>
            ) : null}
          </>
        ) : null,
        duties: dutyNames(m.duties),
        // partner 不选首页（首页固定是 partner 首页，Annie 2026-10-27 Q7 A），格子空着；列表没带就留空。
        home:
          m.home_path === undefined ||
          (!m.is_superadmin && m.account_type === "partner")
            ? null
            : homeLabel(m.home_path),
        email: m.email,
        noEmail: m.duties.length > 0 && !m.email?.trim(),
        onEdit: m.is_superadmin
          ? undefined
          : () =>
              setDialog({ kind: "member", mode: { kind: "edit", member: m } }),
      });
    }
    return map;
  }, [lookups, dutyNames]);

  /** admin 看不到 Super Admin 的行（Annie Qa）；再按搜索框和 Show 筛。 */
  const visibleUsers = useMemo(() => {
    if (view.kind !== "ready") {
      return [];
    }
    const q = search.trim().toLowerCase();
    return view.users.filter((u) => {
      if (!view.isSuperAdmin && normalizeRole(u.role) === "superadmin") {
        return false;
      }
      const pending = isPending(u);
      if (show === "active" && (pending || !u.is_active)) return false;
      if (show === "pending" && !pending) return false;
      if (show === "inactive" && (pending || u.is_active)) return false;
      if (show === "partners" && !isPartner(u)) return false;
      if (!q) return true;
      const email = extras?.get(u.id)?.email ?? "";
      return [pending ? "" : displayNameOf(u), pending ? "" : u.username, email]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [view, search, show, extras]);

  const visibleContacts = useMemo(() => {
    if (!lookups || (show !== "all" && show !== "active")) {
      return [];
    }
    const q = search.trim().toLowerCase();
    return lookups.contacts.filter(
      (c) => !q || `${c.name} ${c.email}`.toLowerCase().includes(q),
    );
  }, [lookups, search, show]);

  const counts = useMemo(() => {
    if (view.kind !== "ready") {
      return null;
    }
    const list = view.users.filter(
      (u) => view.isSuperAdmin || normalizeRole(u.role) !== "superadmin",
    );
    const pending = list.filter(isPending).length;
    const inactive = list.filter((u) => !isPending(u) && !u.is_active).length;
    return {
      people: list.length - pending,
      pending,
      inactive,
      mailboxes: lookups?.contacts.length ?? 0,
    };
  }, [view, lookups]);

  const usersById = useMemo(
    () =>
      new Map(view.kind === "ready" ? view.users.map((u) => [u.id, u]) : []),
    [view],
  );

  return (
    <main className="text-stone-800 night:text-white/90">
      <CenteredPage className="flex flex-col py-7 max-lg:px-8">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <div>
            {/* 旧页面标题是 #1a1a2e，放在深色底上看不见；按深色底换成旧后台的浅色字。 */}
            <h1 className="m-0 text-[22px] font-bold text-[#f8fafc]">Team</h1>
            <p className="mt-1 text-[13px] text-[#6b7280] night:text-white/55">
              {isSuperAdmin
                ? "Everyone who can sign in to NPE Operations: their role, teams and what they can do."
                : "Everyone who can sign in to NPE Operations. Only a Super Admin can change permissions or delete an account."}
            </p>
          </div>
          {view.kind === "ready" ? (
            <button
              type="button"
              onClick={() =>
                setDialog(
                  view.isSuperAdmin
                    ? { kind: "add-person" }
                    : { kind: "invite" },
                )
              }
              className="flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-[linear-gradient(135deg,#1a6b3c,#27ae60)] px-5 py-2.5 text-[14px] font-semibold text-white"
            >
              <span aria-hidden>+</span>
              Add person
            </button>
          ) : null}
        </header>

        {view.kind === "ready" ? (
          <TeamHowTo isSuperAdmin={isSuperAdmin} />
        ) : null}

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

        {view.kind === "ready" && view.teamError ? (
          <div className="mb-4">
            <ErrorBanner
              actionLabel="Retry"
              onAction={() => setReloadKey((k) => k + 1)}
            >
              Could not load permissions: {view.teamError}
            </ErrorBanner>
          </div>
        ) : null}

        {view.kind === "loading" ? <Panel>Loading...</Panel> : null}

        {view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800 night:text-white/90">
              Admin access required
            </p>
            <p className="mt-1">Only admins can manage the team.</p>
          </Panel>
        ) : null}

        {view.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Failed to load the team: {view.message}
          </ErrorBanner>
        ) : null}

        {view.kind === "ready" ? (
          <>
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <input
                type="search"
                aria-label="Search people"
                value={search}
                placeholder="Search name, username or email…"
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 w-[260px] max-w-full rounded-[7px] border border-[#d1d5db] bg-paper px-2.5 text-[13px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
              />
              <label className="flex items-center gap-1.5 text-[13px] text-[#cbd5e1]">
                Show:
                <select
                  aria-label="Show"
                  value={show}
                  onChange={(event) =>
                    setShow(event.target.value as ShowFilter)
                  }
                  className="h-8 rounded-[7px] border border-[#d1d5db] bg-paper px-1.5 text-[13px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
                >
                  {SHOW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {counts ? (
                // 普通文字，不是胶囊（Annie 2026-10-11）。
                <span data-team-counts className="text-[13px] text-[#8ea3b8]">
                  {counts.people} people · {counts.pending} pending invite
                  {counts.pending === 1 ? "" : "s"} · {counts.inactive} inactive
                  {counts.mailboxes
                    ? ` · ${counts.mailboxes} mailbox${counts.mailboxes === 1 ? "" : "es"}`
                    : ""}
                </span>
              ) : null}
            </div>
            {notice ? (
              <p
                role="status"
                className="mb-2.5 text-[13px] font-medium text-[#4ade80]"
              >
                {notice}
              </p>
            ) : null}
            {view.users.length === 0 ? (
              <Panel>No users yet.</Panel>
            ) : (
              <UsersTable
                users={visibleUsers}
                teamsById={teamsById}
                teamsUnavailable={view.teams === null}
                canChangeRoles={view.isSuperAdmin}
                roles={assignableRolesFor(view.withSupervisor)}
                busyUserId={busyUserId}
                extras={extras}
                extraRows={visibleContacts.map((c) => (
                  <ContactRow
                    key={`c${c.id}`}
                    contact={c}
                    duties={dutyNames(c.duties)}
                    onEdit={() => setDialog({ kind: "contact", contact: c })}
                  />
                ))}
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
            {/* 改动记录（G203，/api/team/action-log 只给 Super Admin）。 */}
            {view.isSuperAdmin ? (
              <ActionLogPanel
                refreshKey={logVersion}
                reloadOnOpen
                onUnauthorized={redirectToLogin}
                load={(before, signal) =>
                  fetchActionLog("/api/team/action-log", before, signal)
                }
              />
            ) : null}
          </>
        ) : null}
      </CenteredPage>

      {view.kind === "ready" &&
      dialog?.kind === "member" &&
      view.team &&
      lookups ? (
        <MemberFormDialog
          key={dialog.mode.kind === "edit" ? dialog.mode.member.id : "add"}
          mode={dialog.mode}
          catalog={view.team.catalog}
          members={lookups.memberUsers}
          summaries={lookups.summaries}
          onSaved={() => {
            if (dialog.mode.kind === "edit") {
              setDialog(null);
            }
            void refreshList();
          }}
          onClose={closeDialog}
          toFailure={toActionError}
          onAccountTypeChanged={() => void refreshList()}
          onDelete={
            dialog.mode.kind === "edit"
              ? deleteTarget(dialog.mode.member, usersById, (user, member) =>
                  setDialog({ kind: "delete-person", user, member }),
                )
              : undefined
          }
        />
      ) : null}

      {view.kind === "ready" && dialog?.kind === "contact" ? (
        view.team ? (
          <ContactDutiesDialog
            contact={dialog.contact}
            duties={view.team.catalog.duties}
            onSubmit={(duties) => handleContactDuties(dialog.contact, duties)}
            onClose={closeDialog}
          />
        ) : null
      ) : null}

      {view.kind === "ready" && dialog?.kind === "delete-person" ? (
        <DeletePersonDialog
          name={displayNameOf(dialog.user)}
          meta={`@${dialog.user.username}`}
          canDeactivate={dialog.user.is_active}
          onDelete={() =>
            runDialogAction(
              () => deleteUser(dialog.user.id),
              `${displayNameOf(dialog.user)} was deleted.`,
            )
          }
          onDeactivate={() =>
            runDialogAction(
              () => deactivateUser(dialog.user.id),
              `${displayNameOf(dialog.user)} was deactivated.`,
            )
          }
          onClose={() =>
            setDialog({
              kind: "member",
              mode: { kind: "edit", member: dialog.member },
            })
          }
        />
      ) : null}

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

/**
 * Edit 框里的 Delete：只给 Super Admin（只有 Super Admin 会打开这个框）；Super Admin 账号、自己、
 * 待接受的邀请（行上有 🗑 Cancel invite）不给。对不上 /api/users 的人也不给（没有账号可删）。
 */
function deleteTarget(
  member: TeamMemberUser,
  usersById: ReadonlyMap<number, AdminUser>,
  open: (user: AdminUser, member: TeamMemberUser) => void,
): (() => void) | undefined {
  const user = usersById.get(member.id);
  if (
    !user ||
    member.is_superadmin ||
    normalizeRole(user.role) === "superadmin" ||
    user.is_self ||
    isPending(user)
  ) {
    return undefined;
  }
  return () => open(user, member);
}

const MUTED = <span className="text-[#9ca3af] night:text-white/35">—</span>;

/** 部门邮箱一行（只给 Super Admin）：只有名字、邮箱、职责和 Edit duties。列数同表头（8 列）。 */
function ContactRow({
  contact,
  duties,
  onEdit,
}: {
  contact: TeamMemberContact;
  duties: string | null;
  onEdit: () => void;
}) {
  return (
    <tr
      data-contact-row
      className="border-b border-[#f3f4f6] night:border-white/10"
    >
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#0e7490] text-[15px] font-bold text-white"
          >
            ✉
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#1a1a2e] night:text-white/90">
              {contact.name}
              <span className="ml-1.5 inline-block rounded-[6px] bg-[#e0f2fe] px-[7px] py-px align-middle text-[11px] font-semibold whitespace-nowrap text-[#075985]">
                Department mailbox
              </span>
            </div>
            <div className="mt-px text-[11px] break-all text-[#1a1a1a] night:text-white/35">
              {contact.email}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">{MUTED}</td>
      <td className="px-4 py-3.5">{MUTED}</td>
      <td className="px-4 py-3.5">{MUTED}</td>
      <td className="px-4 py-3.5">{MUTED}</td>
      <td className="max-w-[220px] px-4 py-3.5 text-[13px] text-[#4b5563] night:text-white/55">
        {duties ?? MUTED}
      </td>
      <td className="px-4 py-3.5">{MUTED}</td>
      <td className="px-4 py-3.5">
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onEdit}
            className={cn(
              "cursor-pointer rounded-[6px] border border-[#e5e7eb] bg-[#f3f4f6] px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-[#1a1a1a]",
            )}
          >
            Edit duties
          </button>
        </div>
      </td>
    </tr>
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
    case "member":
    case "contact":
    case "delete-person":
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
            <p>Their permissions ticked under Edit stay as they are.</p>
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
          title="Cancel invite"
          confirmLabel="Cancel invite"
          busyLabel="Cancelling…"
          danger
          onConfirm={() => runAction(() => deleteUser(dialog.user.id))}
          onClose={onClose}
        >
          <p>Cancel this pending invite? The invite link will stop working.</p>
        </ConfirmDialog>
      );
  }
}

/** 折叠的英文说明（同原来 Team 页的蓝框）；两页的说明并成一份。 */
function TeamHowTo({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  return (
    <details className="mb-5 rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3.5 text-[12px] leading-[1.8] text-[#0c3a6b] night:border-sky-400/20 night:bg-sky-400/[.08] night:text-sky-300">
      <summary className="cursor-pointer font-semibold text-[#185FA5] night:text-sky-300">
        📖 How to use — Team
      </summary>
      <ol className="m-0 mt-1.5 list-decimal pl-[18px]">
        <li>
          Add a person: click Add person.{" "}
          {isSuperAdmin
            ? "Tick their permissions, then send an invite link (they choose their own username and password) or create the account now with a username and password."
            : "Click Generate Invite Link, then Copy, and send the link to them. They pick their own username and password when they open it."}{" "}
          Until they register their row shows Pending; Copy Link copies the link
          again and 🗑 Cancel invite stops the link working.
        </li>
        <li>
          Find someone: type in the search box, or pick Show to see only active
          people, pending invites, inactive accounts or partners.
        </li>
        <li>
          Teams: click the team names in a person&apos;s row (or + Add), tick
          the teams, then Save. Teams only group people for messages. They give
          no permissions.
        </li>
        <li>
          Name: click ✏️ Name to change how a person&apos;s name shows. This
          does not change their initials, which are their signature on actions.
        </li>
        {isSuperAdmin ? (
          <>
            <li>
              Role: pick a new role in the Role column, then click Change Role
              in the box that opens. Changing the role does not change the
              permissions ticked under Edit. Driver and Guide lose all
              back-office access. Supervisor works like Staff (no Settings or
              Users).
            </li>
            <li>
              Permissions: click Edit on a person&apos;s row and choose None,
              Read only or Read &amp; edit for each module (Full access where a
              page cannot be split), then click Save. Read only means they can
              open and look. Read &amp; edit also lets them change, send,
              publish, export and delete. &quot;Custom&quot; means the person
              has part of a module that does not match one of the choices. To
              give someone the same access as another person, pick that person
              in &quot;Copy access from&quot;, click Copy, adjust, then Save. A
              module marked &quot;Not active yet&quot; is not checked by the
              system yet.
            </li>
            <li>
              Notification duties: when something happens (for example a
              complaint), everyone ticked for that duty is notified, plus a
              department mailbox if it is ticked. Edit duties on a mailbox row
              changes only its duties.
            </li>
            <li>
              Edit a person → Contact (top of the form): type Email and Mobile,
              then Save. Both are optional. Leave a box empty to clear it.
            </li>
            <li>
              Email is where duty notifications go. A person with duties but no
              email gets a yellow No email tag and misses those notifications.
            </li>
            <li>Mobile is stored only for now; nothing is sent to it yet.</li>
            <li>
              Drivers and guides with an HR file show the HR phone, read-only.
              To change it, use Edit in Human Resource.
            </li>
            <li>
              If you see &apos;That email address is already used by …&apos;,
              that email belongs to the account named. Use a different one or
              fix the other account first.
            </li>
            <li>
              Phone format: 10 digits (US), or + and the country code. Spaces,
              dashes, dots and brackets are fine.
            </li>
            <li>
              Add person: Contact is there for both ways (create now / invite
              link). An invite keeps the email and mobile you typed after the
              person registers.
            </li>
          </>
        ) : null}
        <li>
          Forgot a password: click Reset password, then Create link, then Copy
          link, and send the link to the person yourself. It is shown only once
          and works once, for 24 hours. A new link cancels the earlier one.
        </li>
        <li>
          Stop someone logging in: click Deactivate, then Deactivate in the box
          that opens. They are logged out straight away. Reactivate lets them
          back in.
        </li>
        <li>
          {isSuperAdmin
            ? "Delete an account for good: click Edit on their row, then Delete at the bottom left, then Yes. It cannot be undone. If they still have task handovers or Dispatch records it cannot be deleted; the box says why and offers Deactivate instead. Super Admin accounts and your own account cannot be deleted or edited here."
            : "Only a Super Admin can change permissions or delete an account."}
        </li>
      </ol>
    </details>
  );
}
