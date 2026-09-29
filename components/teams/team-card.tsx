import type { Team } from "@/types";

import { formatMemberCount } from "./config";

interface TeamCardProps {
  team: Team;
  onEdit: (team: Team) => void;
  onDelete: (team: Team) => void;
}

export function TeamCard({ team, onEdit, onDelete }: TeamCardProps) {
  return (
    <li className="flex items-center gap-4 rounded-lg border border-stone-200 bg-white px-5 py-4">
      <span
        aria-hidden
        className="h-12 w-3.5 shrink-0 rounded"
        style={{ backgroundColor: team.color }}
      />

      <div className="min-w-0 flex-1">
        <div className="font-semibold break-words text-stone-900">
          {team.name}
        </div>
        {team.description ? (
          <div className="mt-0.5 text-sm break-words text-stone-600">
            {team.description}
          </div>
        ) : null}
        <div className="mt-1 text-xs text-stone-400">
          {formatMemberCount(team.member_count)}
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => onEdit(team)}
          className="rounded-md border border-stone-300 bg-stone-50 px-3.5 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(team)}
          className="rounded-md border border-[#A32D2D]/30 bg-[#FCEBEB] px-3.5 py-1.5 text-sm text-[#A32D2D] hover:bg-[#F8DCDC]"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
