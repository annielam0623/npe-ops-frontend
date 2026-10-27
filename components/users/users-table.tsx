"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { AdminUser, AssignableRole, Team, UserRole } from "@/types";

import {
  ROLE_STYLES,
  avatarTextOf,
  displayNameOf,
  formatJoinedDate,
  isAssignableRole,
  isPartner,
  isPending,
  normalizeRole,
} from "./config";

export interface UserRowActions {
  onEditName: (user: AdminUser) => void;
  onAssignTeams: (user: AdminUser) => void;
  onChangeRole: (user: AdminUser, role: AssignableRole) => void;
  onDeactivate: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
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
  /** 下拉框里给的角色（后端还不认 supervisor 时不含它）。 */
  roles: readonly AssignableRole[];
  /** 正在恢复的账号（恢复不弹确认框，按钮上显示进行中）。 */
  busyUserId: number | null;
}

// 样式照旧页面 settings_users.html 的行内 style。
const TH_CLASS =
  "px-4 py-3 text-[12px] font-semibold tracking-[.05em] text-[#1a1a1a] night:text-white/55 uppercase";

const SMALL_BUTTON_CLASS =
  "cursor-pointer rounded-[6px] py-1.5 text-[12px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";

/** 旧页面的 🗑：浅红底、无边框。 */
const BIN_BUTTON_CLASS = cn(
  SMALL_BUTTON_CLASS,
  "border-0 bg-[#fef2f2] night:bg-red-500/10 px-2.5 text-[#dc2626] night:text-red-300",
);

const BADGE_CLASS =
  "inline-block rounded-[20px] px-2.5 py-[3px] text-[12px] font-semibold whitespace-nowrap";

export function UsersTable({
  users,
  teamsById,
  canChangeRoles,
  roles,
  busyUserId,
  ...actions
}: UsersTableProps) {
  return (
    <div className="overflow-x-auto rounded-[12px] bg-paper shadow-[0_1px_6px_rgba(0,0,0,.08)] night:bg-white/[.04]">
      <table className="w-full min-w-[960px] border-collapse">
        <thead>
          <tr className="border-b border-[#e5e7eb] bg-paper night:border-white/10 night:bg-white/[.03]">
            <th className={cn(TH_CLASS, "text-left")}>User</th>
            <th className={cn(TH_CLASS, "text-left")}>Role</th>
            <th className={cn(TH_CLASS, "text-left")}>Status</th>
            <th className={cn(TH_CLASS, "text-left")}>Teams</th>
            <th className={cn(TH_CLASS, "text-left")}>Invited By</th>
            <th className={cn(TH_CLASS, "text-left")}>Joined</th>
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
                !isPartner(user) &&
                !isPending(user) &&
                !user.is_self &&
                isAssignableRole(user.role) &&
                roles.includes(user.role)
              }
              roles={roles}
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
  roles,
  busy,
  actions,
}: {
  user: AdminUser;
  teamsById: ReadonlyMap<number, Team>;
  canChangeRole: boolean;
  roles: readonly AssignableRole[];
  busy: boolean;
  actions: UserRowActions;
}) {
  const pending = isPending(user);
  const role = normalizeRole(user.role);

  return (
    <tr
      className={cn(
        "border-b border-[#f3f4f6] night:border-white/10",
        !pending && !user.is_active && "opacity-55",
      )}
    >
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className={cn(
              // 旧页面待注册行也按角色上色（只是字是 ?）。
              "flex size-[38px] shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white",
              ROLE_STYLES[role].avatarClass,
            )}
          >
            {avatarTextOf(user)}
          </div>
          <div className="min-w-0">
            {pending ? (
              <div className="text-[14px] font-semibold text-[#9ca3af] italic night:text-white/35">
                Pending registration…
              </div>
            ) : (
              <>
                <div className="text-[14px] font-semibold break-words text-[#1a1a2e] night:text-white/90">
                  {displayNameOf(user)}
                  {user.is_self ? (
                    <span className="ml-1 text-[11px] text-[#1a1a1a] night:text-white/35">
                      (you)
                    </span>
                  ) : null}
                </div>
                <div className="mt-px text-[11px] break-all text-[#1a1a1a] night:text-white/35">
                  @{user.username} · {user.initials?.trim() || "—"}
                </div>
              </>
            )}
          </div>
        </div>
      </td>

      <td className="px-4 py-3.5">
        {canChangeRole ? (
          <RoleSelect
            user={user}
            roles={roles}
            onChange={actions.onChangeRole}
          />
        ) : (
          <span className={cn(BADGE_CLASS, ROLE_STYLES[role].badgeClass)}>
            {ROLE_STYLES[role].label}
          </span>
        )}
        {/* partner 的角色不能在这里改（后端 400），只能去 Team 页切换类型。 */}
        {isPartner(user) ? (
          <div className="mt-1 text-[11px]">
            <Link
              href="/settings/team"
              className="text-[#1f4e79] underline night:text-sky-300"
            >
              Change type on the Team page
            </Link>
          </div>
        ) : null}
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

      <td className="px-4 py-3.5 text-[13px] break-words text-[#1a1a1a] night:text-white/55">
        {user.created_by || "—"}
      </td>

      <td
        className={cn(
          "px-4 py-3.5 text-[13px] whitespace-nowrap",
          pending
            ? "text-[#d1d5db] night:text-white/35"
            : "text-[#1a1a1a] night:text-white/55",
        )}
      >
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
  roles,
  onChange,
}: {
  user: AdminUser;
  roles: readonly AssignableRole[];
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
        if (isAssignableRole(next) && roles.includes(next) && next !== role) {
          onChange(user, next);
        }
      }}
      className={cn(
        "cursor-pointer rounded-[20px] border border-[#d1d5db] bg-paper px-2 py-[3px] text-[12px] font-semibold night:border-white/10 night:bg-white/[.04]",
        ROLE_STYLES[role].textClass,
      )}
    >
      {roles.map((option) => (
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
      <span
        className={cn(
          BADGE_CLASS,
          "bg-[#fef9c3] text-[#854d0e] night:bg-amber-400/10 night:text-amber-200",
        )}
      >
        ⏳ Pending
      </span>
    );
  }
  if (user.is_active) {
    return (
      <span
        className={cn(
          BADGE_CLASS,
          "bg-[#dcfce7] text-[#166534] night:bg-emerald-400/10 night:text-emerald-300",
        )}
      >
        ● Active
      </span>
    );
  }
  return (
    <span
      className={cn(
        BADGE_CLASS,
        "bg-[#f3f4f6] text-[#1a1a1a] night:bg-white/[.07] night:text-white/55",
      )}
    >
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
  // partner 不进任何团队（同 Team 页「Not for external partners」）。
  if (isPartner(user)) {
    return (
      <span className="text-[12px] text-[#9ca3af] night:text-white/35">
        —
      </span>
    );
  }
  const teams = user.team_ids
    .map((id) => teamsById.get(id))
    .filter((team): team is Team => team !== undefined);

  return (
    <button
      type="button"
      onClick={onClick}
      title="Assign teams"
      className="flex cursor-pointer flex-wrap items-center gap-[5px] text-left focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none"
    >
      {teams.length === 0 ? (
        <span className="text-[12px] text-[#1a1a1a] night:text-white/35">
          + Add
        </span>
      ) : (
        teams.map((team) => (
          <span
            key={team.id}
            className="rounded-[12px] border px-[9px] py-0.5 text-[12px] font-semibold"
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

/** 只有 admin 看得到这页；自己的账号、superadmin、已停用的账号灰掉，鼠标移上去写后端的原话。 */
function ResetPasswordButton({
  user,
  role,
  onClick,
}: {
  user: AdminUser;
  role: UserRole;
  onClick: (user: AdminUser) => void;
}) {
  const reason = user.is_self
    ? "Cannot generate a reset link for your own account"
    : role === "superadmin"
      ? "Cannot reset a superadmin account's password"
      : !user.is_active
        ? "Cannot generate a reset link for an inactive account"
        : undefined;
  return (
    <button
      type="button"
      onClick={() => onClick(user)}
      disabled={reason !== undefined}
      title={reason}
      className={cn(
        SMALL_BUTTON_CLASS,
        "border border-[#e5e7eb] bg-paper px-3 font-medium text-[#1a1a1a] night:border-white/10 night:bg-white/[.07] night:text-white/75",
      )}
    >
      Reset password
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
    return (
      <ResetPasswordButton
        user={user}
        role={role}
        onClick={actions.onResetPassword}
      />
    );
  }

  // 后端对 superadmin 的停用 / 恢复 / 删除一律 400，这里不显示这些按钮；改显示名不受限。
  const protectedAccount = role === "superadmin";

  const deleteButton = protectedAccount ? null : (
    <button
      type="button"
      onClick={() => actions.onDelete(user)}
      disabled={busy}
      aria-label="Delete"
      title={isPending(user) ? "Remove pending invite" : undefined}
      className={BIN_BUTTON_CLASS}
    >
      🗑
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
        <ResetPasswordButton
          user={user}
          role={role}
          onClick={actions.onResetPassword}
        />
        <button
          type="button"
          onClick={() => actions.onEditName(user)}
          className={cn(
            SMALL_BUTTON_CLASS,
            "border border-[#e5e7eb] bg-[#f3f4f6] px-3 font-medium text-[#1a1a1a] night:border-white/10 night:bg-white/[.07] night:text-white/75",
          )}
        >
          ✏️ Name
        </button>
        {protectedAccount ? null : (
          <button
            type="button"
            onClick={() => actions.onDeactivate(user)}
            className={cn(
              SMALL_BUTTON_CLASS,
              "border border-[#fed7aa] bg-[#fff4e5] px-3.5 font-semibold text-[#c2410c] night:border-amber-400/30 night:bg-amber-400/10 night:text-amber-200",
            )}
          >
            Deactivate
          </button>
        )}
      </>
    );
  }

  if (protectedAccount) {
    return (
      <ResetPasswordButton
        user={user}
        role={role}
        onClick={actions.onResetPassword}
      />
    );
  }

  return (
    <>
      <ResetPasswordButton
        user={user}
        role={role}
        onClick={actions.onResetPassword}
      />
      <button
        type="button"
        onClick={() => actions.onReactivate(user)}
        disabled={busy}
        className={cn(
          SMALL_BUTTON_CLASS,
          "border border-[#bbf7d0] bg-[#dcfce7] px-3.5 font-semibold text-[#166534] night:border-emerald-400/30 night:bg-emerald-400/10 night:text-emerald-300",
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
      title="Copy invite link"
      className={cn(
        SMALL_BUTTON_CLASS,
        "border-0 bg-[#f3f4f6] px-3 font-medium text-[#1a1a1a] night:bg-white/[.07] night:text-white/75",
      )}
    >
      {copied ? "✓ Copied" : "📋 Copy Link"}
    </button>
  );
}
