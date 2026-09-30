"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { AdminUser, AssignableRole, Team, UserRole } from "@/types";

import {
  ASSIGNABLE_ROLES,
  ROLE_STYLES,
  avatarTextOf,
  displayNameOf,
  formatJoinedDate,
  isAssignableRole,
  isPending,
  normalizeRole,
} from "./config";

export interface UserRowActions {
  onEditName: (user: AdminUser) => void;
  onAssignTeams: (user: AdminUser) => void;
  onChangeRole: (user: AdminUser, role: AssignableRole) => void;
  onDeactivate: (user: AdminUser) => void;
  onReactivate: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
  /** 复制待注册邀请链接，成功返回 true。 */
  onCopyLink: (user: AdminUser) => Promise<boolean>;
}

interface UsersTableProps extends UserRowActions {
  users: AdminUser[];
  teamsById: ReadonlyMap<number, Team>;
  /** 只有 superadmin 能改角色。 */
  canChangeRoles: boolean;
  /** 正在恢复的账号（恢复不弹确认框，按钮上显示进行中）。 */
  busyUserId: number | null;
}

const TH_CLASS =
  "px-4 py-3 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase";

const SMALL_BUTTON_CLASS =
  "rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";

const NEUTRAL_SMALL_BUTTON_CLASS = cn(
  SMALL_BUTTON_CLASS,
  "border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100",
);

const BADGE_CLASS =
  "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";

export function UsersTable({
  users,
  teamsById,
  canChangeRoles,
  busyUserId,
  ...actions
}: UsersTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="w-full min-w-[960px] border-collapse">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50">
            <th className={TH_CLASS}>User</th>
            <th className={TH_CLASS}>Role</th>
            <th className={TH_CLASS}>Status</th>
            <th className={TH_CLASS}>Teams</th>
            <th className={TH_CLASS}>Invited By</th>
            <th className={TH_CLASS}>Joined</th>
            <th className={cn(TH_CLASS, "text-center")}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              teamsById={teamsById}
              canChangeRole={
                canChangeRoles &&
                !isPending(user) &&
                !user.is_self &&
                isAssignableRole(user.role)
              }
              busy={busyUserId === user.id}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  user,
  teamsById,
  canChangeRole,
  busy,
  actions,
}: {
  user: AdminUser;
  teamsById: ReadonlyMap<number, Team>;
  canChangeRole: boolean;
  busy: boolean;
  actions: UserRowActions;
}) {
  const pending = isPending(user);
  const role = normalizeRole(user.role);

  return (
    <tr
      className={cn(
        "border-b border-stone-100 last:border-b-0",
        !pending && !user.is_active && "opacity-55",
      )}
    >
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
              pending ? "bg-stone-300" : ROLE_STYLES[role].avatarClass,
            )}
          >
            {avatarTextOf(user)}
          </div>
          <div className="min-w-0">
            {pending ? (
              <div className="text-sm text-stone-400 italic">
                Pending registration…
              </div>
            ) : (
              <>
                <div className="text-sm font-semibold break-words text-stone-900">
                  {displayNameOf(user)}
                  {user.is_self ? (
                    <span className="ml-1 text-xs font-normal text-stone-400">
                      (you)
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs break-all text-stone-400">
                  @{user.username} · {user.initials?.trim() || "—"}
                </div>
              </>
            )}
          </div>
        </div>
      </td>

      <td className="px-4 py-3.5">
        {canChangeRole ? (
          <RoleSelect user={user} onChange={actions.onChangeRole} />
        ) : (
          <span className={cn(BADGE_CLASS, ROLE_STYLES[role].badgeClass)}>
            {ROLE_STYLES[role].label}
          </span>
        )}
      </td>

      <td className="px-4 py-3.5">
        <StatusBadge user={user} />
      </td>

      <td className="px-4 py-3.5">
        <TeamChips
          user={user}
          teamsById={teamsById}
          onClick={() => actions.onAssignTeams(user)}
        />
      </td>

      <td className="px-4 py-3.5 text-sm break-words text-stone-500">
        {user.created_by || "—"}
      </td>

      <td className="px-4 py-3.5 text-sm whitespace-nowrap text-stone-500">
        {formatJoinedDate(user)}
      </td>

      <td className="px-4 py-3.5">
        <div className="flex justify-center gap-2">
          <RowActions user={user} role={role} busy={busy} actions={actions} />
        </div>
      </td>
    </tr>
  );
}

function RoleSelect({
  user,
  onChange,
}: {
  user: AdminUser;
  onChange: (user: AdminUser, role: AssignableRole) => void;
}) {
  const role = normalizeRole(user.role);
  return (
    // 受控：值始终是后端的当前角色；选了新值只打开确认框，取消后自然回到原值。
    <select
      aria-label={`Role for ${displayNameOf(user)}`}
      value={role}
      onChange={(event) => {
        const next = event.target.value;
        if (isAssignableRole(next) && next !== role) {
          onChange(user, next);
        }
      }}
      className={cn(
        "cursor-pointer rounded-full border border-stone-300 bg-white px-2 py-0.5 text-xs font-semibold",
        ROLE_STYLES[role].textClass,
      )}
    >
      {ASSIGNABLE_ROLES.map((option) => (
        <option key={option} value={option}>
          {ROLE_STYLES[option].label}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ user }: { user: AdminUser }) {
  if (isPending(user)) {
    return (
      <span className={cn(BADGE_CLASS, "bg-[#fef9c3] text-[#854d0e]")}>
        ⏳ Pending
      </span>
    );
  }
  if (user.is_active) {
    return (
      <span className={cn(BADGE_CLASS, "bg-[#dcfce7] text-[#166534]")}>
        ● Active
      </span>
    );
  }
  return (
    <span className={cn(BADGE_CLASS, "bg-stone-100 text-stone-500")}>
      ○ Inactive
    </span>
  );
}

function TeamChips({
  user,
  teamsById,
  onClick,
}: {
  user: AdminUser;
  teamsById: ReadonlyMap<number, Team>;
  onClick: () => void;
}) {
  const teams = user.team_ids
    .map((id) => teamsById.get(id))
    .filter((team): team is Team => team !== undefined);

  return (
    <button
      type="button"
      onClick={onClick}
      title="Assign teams"
      className="flex cursor-pointer flex-wrap items-center gap-1.5 rounded-md p-0.5 text-left hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none"
    >
      {teams.length === 0 ? (
        <span className="text-xs text-stone-400">+ Add</span>
      ) : (
        teams.map((team) => (
          <span
            key={team.id}
            className="rounded-full border px-2 py-0.5 text-xs font-semibold"
            style={{
              color: team.color,
              backgroundColor: `${team.color}22`,
              borderColor: `${team.color}55`,
            }}
          >
            {team.name}
          </span>
        ))
      )}
    </button>
  );
}

function RowActions({
  user,
  role,
  busy,
  actions,
}: {
  user: AdminUser;
  role: UserRole;
  busy: boolean;
  actions: UserRowActions;
}) {
  if (user.is_self) {
    return <span className="text-xs text-stone-300">—</span>;
  }

  // 后端对 superadmin 的停用 / 恢复 / 删除一律 400，这里不显示这些按钮；改显示名不受限。
  const protectedAccount = role === "superadmin";

  const deleteButton = protectedAccount ? null : (
    <button
      type="button"
      onClick={() => actions.onDelete(user)}
      disabled={busy}
      className={cn(
        SMALL_BUTTON_CLASS,
        "border-[#A32D2D]/30 bg-[#FCEBEB] text-[#A32D2D] hover:bg-[#F8DCDC]",
      )}
    >
      Delete
    </button>
  );

  if (isPending(user)) {
    return (
      <>
        {user.invite_token ? (
          <CopyLinkButton user={user} onCopy={actions.onCopyLink} />
        ) : null}
        {deleteButton}
      </>
    );
  }

  if (user.is_active) {
    return (
      <>
        <button
          type="button"
          onClick={() => actions.onEditName(user)}
          className={NEUTRAL_SMALL_BUTTON_CLASS}
        >
          Edit Name
        </button>
        {protectedAccount ? null : (
          <button
            type="button"
            onClick={() => actions.onDeactivate(user)}
            className={cn(
              SMALL_BUTTON_CLASS,
              "border-[#fed7aa] bg-[#fff4e5] text-[#c2410c] hover:bg-[#ffead0]",
            )}
          >
            Deactivate
          </button>
        )}
      </>
    );
  }

  if (protectedAccount) {
    return <span className="text-xs text-stone-300">—</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => actions.onReactivate(user)}
        disabled={busy}
        className={cn(
          SMALL_BUTTON_CLASS,
          "border-[#bbf7d0] bg-[#dcfce7] text-[#166534] hover:bg-[#c9f5d8]",
        )}
      >
        {busy ? "Reactivating…" : "Reactivate"}
      </button>
      {deleteButton}
    </>
  );
}

function CopyLinkButton({
  user,
  onCopy,
}: {
  user: AdminUser;
  onCopy: (user: AdminUser) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => setCopied(await onCopy(user))}
      className={NEUTRAL_SMALL_BUTTON_CLASS}
    >
      {copied ? "✓ Copied" : "Copy Link"}
    </button>
  );
}
