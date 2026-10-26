"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type {
  Duty,
  TeamMember,
  TeamMemberContact,
  TeamMemberUser,
  TeamRef,
} from "@/types";

import { avatarText, homeLabel, memberName } from "./config";
import { TeamChip } from "./team-chip";

// 样式照 Users 页的表（settings_users.html 的行内 style）。
const TH_CLASS =
  "px-3.5 py-3 text-left text-[12px] font-semibold tracking-[.05em] text-[#1a1a1a] uppercase";
const TD_CLASS = "px-3.5 py-3 align-middle text-[13px]";
const BADGE_CLASS =
  "inline-block rounded-[20px] px-2.5 py-[3px] text-[12px] font-semibold whitespace-nowrap";
const TAG_CLASS =
  "ml-1.5 inline-block rounded-[6px] px-[7px] py-px align-middle text-[11px] font-semibold whitespace-nowrap";
const EDIT_BUTTON_CLASS =
  "cursor-pointer rounded-[6px] border border-[#e5e7eb] bg-[#f3f4f6] px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-[#1a1a1a]";
const AVATAR_COLORS = [
  "#1a3a5c",
  "#2d6a4f",
  "#4338ca",
  "#b45309",
  "#0e7490",
  "#be185d",
  "#4d7c0f",
  "#9a3412",
];
const MUTED = <span className="text-[#9ca3af]">—</span>;

export function MembersTable({
  members,
  teamsById,
  dutiesByCode,
  totalItems,
  onEdit,
  onEditContact,
}: {
  members: TeamMember[];
  teamsById: ReadonlyMap<number, TeamRef>;
  dutiesByCode: ReadonlyMap<string, Duty>;
  totalItems: number;
  onEdit: (member: TeamMemberUser) => void;
  onEditContact: (contact: TeamMemberContact) => void;
}) {
  const dutyNames = (codes: string[]) =>
    codes.length
      ? codes.map((c) => dutiesByCode.get(c)?.display_name ?? c).join(", ")
      : MUTED;

  return (
    <div className="overflow-x-auto rounded-[12px] bg-paper text-[#1a1a2e] shadow-[0_1px_6px_rgba(0,0,0,.08)]">
      <table className="w-full min-w-[980px] border-collapse">
        <thead>
          <tr className="border-b border-[#e5e7eb]">
            <th className={TH_CLASS}>Person</th>
            <th className={TH_CLASS}>Sign-in</th>
            <th className={TH_CLASS}>Teams</th>
            <th className={TH_CLASS}>Permissions</th>
            <th className={TH_CLASS}>Notification duties</th>
            <th className={TH_CLASS}>Home page</th>
            <th className={TH_CLASS}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) =>
            m.kind === "user" ? (
              <UserRow
                key={`u${m.id}`}
                member={m}
                teamsById={teamsById}
                totalItems={totalItems}
                dutyNames={dutyNames}
                onEdit={onEdit}
              />
            ) : (
              <tr key={`c${m.id}`} className="border-b border-[#f3f4f6]">
                <td className={TD_CLASS}>
                  <div className="flex items-center gap-3">
                    <div
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0e7490] text-[14px] font-bold text-white"
                    >
                      ✉
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold">
                        {m.name}
                        <span
                          className={cn(
                            TAG_CLASS,
                            "bg-[#e0f2fe] text-[#075985]",
                          )}
                        >
                          Department mailbox
                        </span>
                      </div>
                      <div className="text-[11px] break-all text-[#1a1a1a]">
                        {m.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td className={TD_CLASS}>{MUTED}</td>
                <td className={TD_CLASS}>{MUTED}</td>
                <td className={TD_CLASS}>{MUTED}</td>
                <td className={cn(TD_CLASS, "max-w-[220px] text-[#4b5563]")}>
                  {dutyNames(m.duties)}
                </td>
                <td className={TD_CLASS}>{MUTED}</td>
                <td className={TD_CLASS}>
                  <button
                    type="button"
                    onClick={() => onEditContact(m)}
                    className={EDIT_BUTTON_CLASS}
                  >
                    Edit duties
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  member,
  teamsById,
  totalItems,
  dutyNames,
  onEdit,
}: {
  member: TeamMemberUser;
  teamsById: ReadonlyMap<number, TeamRef>;
  totalItems: number;
  dutyNames: (codes: string[]) => ReactNode;
  onEdit: (member: TeamMemberUser) => void;
}) {
  const teams = member.team_ids
    .map((id) => teamsById.get(id))
    .filter((t): t is TeamRef => t !== undefined);
  const inactive = !member.pending_invite && !member.can_login;

  return (
    <tr className={cn("border-b border-[#f3f4f6]", inactive && "opacity-55")}>
      <td className={TD_CLASS}>
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
            style={{
              backgroundColor: member.is_superadmin
                ? "#6d28d9"
                : AVATAR_COLORS[member.id % AVATAR_COLORS.length],
            }}
          >
            {avatarText(member)}
          </div>
          <div className="min-w-0">
            {member.pending_invite ? (
              <>
                <div className="text-[14px] font-semibold text-[#9ca3af] italic">
                  Pending registration…
                </div>
                <div className="text-[11px] text-[#1a1a1a]">
                  Invite link not used yet
                </div>
              </>
            ) : (
              <>
                <div className="text-[14px] font-semibold break-words">
                  {memberName(member)}
                  {member.is_superadmin ? (
                    <span
                      className={cn(TAG_CLASS, "bg-[#ede9fe] text-[#5b21b6]")}
                    >
                      Super Admin
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] break-all text-[#1a1a1a]">
                  @{member.username}
                  {member.email ? ` · ${member.email}` : ""}
                </div>
              </>
            )}
          </div>
        </div>
      </td>
      <td className={TD_CLASS}>
        {member.pending_invite ? (
          <span className={cn(BADGE_CLASS, "bg-[#fef9c3] text-[#854d0e]")}>
            ⏳ Pending invite
          </span>
        ) : member.can_login ? (
          <span className={cn(BADGE_CLASS, "bg-[#dcfce7] text-[#166534]")}>
            ● Can sign in
          </span>
        ) : (
          <span className={cn(BADGE_CLASS, "bg-[#f3f4f6] text-[#1a1a1a]")}>
            ○ Cannot sign in
          </span>
        )}
      </td>
      <td className={TD_CLASS}>
        {teams.length ? (
          <div className="flex flex-wrap gap-[5px]">
            {teams.map((t) => (
              <TeamChip key={t.id} team={t} />
            ))}
          </div>
        ) : (
          MUTED
        )}
      </td>
      {/* 计数用普通文字（不是胶囊、不用蓝色，Annie 2026-10-11）。 */}
      <td className={cn(TD_CLASS, "whitespace-nowrap tabular-nums")}>
        {member.is_superadmin ? (
          "All"
        ) : (
          <>
            {member.item_count}{" "}
            <span className="text-[#9ca3af]">/ {totalItems}</span>
          </>
        )}
      </td>
      <td className={cn(TD_CLASS, "max-w-[220px] text-[#4b5563]")}>
        {dutyNames(member.duties)}
      </td>
      {/* 列表行带 home_path 之前（后端 2026-10-25 登记）这里留空。 */}
      <td className={TD_CLASS}>
        {"home_path" in member ? homeLabel(member.home_path) : null}
      </td>
      <td className={TD_CLASS}>
        {member.is_superadmin ? (
          <span className="text-[12px] whitespace-nowrap text-[#9ca3af]">
            🔒 Cannot be edited
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onEdit(member)}
            className={EDIT_BUTTON_CLASS}
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}
