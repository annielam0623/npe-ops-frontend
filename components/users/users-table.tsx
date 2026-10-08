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

// 样式照旧页面 settings_users.html 的行内 style。
const TH_CLASS =
  "px-4 py-3 text-[12px] font-semibold tracking-[.05em] text-[#6b7280] uppercase";

const SMALL_BUTTON_CLASS =
  "cursor-pointer rounded-[6px] py-1.5 text-[12px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";

/** 旧页面的 🗑：浅红底、无边框。 */
const BIN_BUTTON_CLASS = cn(
  SMALL_BUTTON_CLASS,
  "border-0 bg-[#fef2f2] px-2.5 text-[#dc2626]",
);

const BADGE_CLASS =
  "inline-block rounded-[20px] px-2.5 py-[3px] text-[12px] font-semibold whitespace-nowrap";

export function UsersTable({
  users,
  teamsById,
  canChangeRoles,
  busyUserId,
  ...actions
}: UsersTableProps) {
  return (
    <div className="overflow-x-auto rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,.08)]">
      <table className="w-full min-w-[960px] border-collapse">
        <thead>
          <tr className="border-b border-[#e5e7eb] bg-[#f9fafb]">
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
        "border-b border-[#f3f4f6]",
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
              <div className="text-[14px] font-semibold text-[#9ca3af] italic">
                Pending registration…
              </div>
            ) : (
              <>
                <div className="text-[14px] font-semibold break-words text-[#1a1a2e]">
                  {displayNameOf(user)}
                  {user.is_self ? (
                    <span className="ml-1 text-[11px] text-[#9ca3af]">
                      (you)
                    </span>
                  ) : null}
                </div>
                <div className="mt-px text-[11px] break-all text-[#9ca3af]">
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

      <td className="px-4 py-3.5 text-[13px] break-words text-[#6b7280]">
        {user.created_by || "—"}
      </td>

      <td
        className={cn(
          "px-4 py-3.5 text-[13px] whitespace-nowrap",
          pending ? "text-[#d1d5db]" : "text-[#6b7280]",
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
        "cursor-pointer rounded-[20px] border border-[#d1d5db] bg-white px-2 py-[3px] text-[12px] font-semibold",
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
    <span className={cn(BADGE_CLASS, "bg-[#f3f4f6] text-[#6b7280]")}>
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
      className="flex cursor-pointer flex-wrap items-center gap-[5px] text-left focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none"
    >
      {teams.length === 0 ? (
        <span className="text-[12px] text-[#d1d5db]">+ Add</span>
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
    return <span className="text-[12px] text-[#d1d5db]">—</span>;
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
        <button
          type="button"
          onClick={() => actions.onEditName(user)}
          className={cn(
            SMALL_BUTTON_CLASS,
            "border border-[#e5e7eb] bg-[#f3f4f6] px-3 font-medium text-[#374151]",
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
              "border border-[#fed7aa] bg-[#fff4e5] px-3.5 font-semibold text-[#c2410c]",
            )}
          >
            Deactivate
          </button>
        )}
      </>
    );
  }

  if (protectedAccount) {
    return <span className="text-[12px] text-[#d1d5db]">—</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => actions.onReactivate(user)}
        disabled={busy}
        className={cn(
          SMALL_BUTTON_CLASS,
          "border border-[#bbf7d0] bg-[#dcfce7] px-3.5 font-semibold text-[#166534]",
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
        "border-0 bg-[#f3f4f6] px-3 font-medium text-[#374151]",
      )}
    >
      {copied ? "✓ Copied" : "📋 Copy Link"}
    </button>
  );
}
