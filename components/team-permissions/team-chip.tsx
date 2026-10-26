import type { TeamRef } from "@/types";

/** 团队名小胶囊，配色同 Users 页的团队列（团队色字 + 淡底 + 边）。 */
export function TeamChip({ team }: { team: TeamRef }) {
  return (
    <span
      className="rounded-[12px] border px-[9px] py-0.5 text-[12px] font-semibold"
      style={{
        color: team.color,
        backgroundColor: `${team.color}22`,
        borderColor: `${team.color}55`,
      }}
    >
      {team.name}
    </span>
  );
}
