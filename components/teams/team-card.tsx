import type { Team } from "@/types";

import { formatMemberCount } from "./config";

interface TeamCardProps {
  team: Team;
  onEdit: (team: Team) => void;
  onDelete: (team: Team) => void;
}

/** 样式照旧页面 settings_teams.html 的 .team-card。 */
export function TeamCard({ team, onEdit, onDelete }: TeamCardProps) {
  return (
    <li className="mb-3.5 flex items-center gap-4 rounded-[12px] border border-[#e8e8e8] bg-white px-6 py-5">
      <span
        aria-hidden
        className="h-12 w-3.5 shrink-0 rounded-[4px]"
        style={{ backgroundColor: team.color }}
      />

      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold break-words text-[#1a1a1a]">
          {team.name}
        </div>
        {team.description ? (
          <div className="mt-[3px] text-[13px] break-words text-[#666]">
            {team.description}
          </div>
        ) : null}
        <div className="mt-1 text-[12px] text-[#aaa]">
          {formatMemberCount(team.member_count)}
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => onEdit(team)}
          className="cursor-pointer rounded-[6px] border border-[#ddd] bg-[#f5f5f5] px-4 py-[7px] text-[13px] text-[#333]"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(team)}
          className="cursor-pointer rounded-[6px] border border-[#ffc5c5] bg-[#fff5f5] px-4 py-[7px] text-[13px] text-[#c0392b]"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
