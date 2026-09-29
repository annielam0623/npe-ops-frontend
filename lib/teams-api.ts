import { apiFetch } from "@/lib/api-client";
import type { CreateTeamResult, Team, TeamInput } from "@/types";

// ⚠️ 列表是 /api/admin/teams，不是 /api/teams：GET /api/teams 被后端另一个旧接口占着（待办 B68 / B71）。
export function fetchTeams(signal?: AbortSignal): Promise<Team[]> {
  return apiFetch<Team[]>("/api/admin/teams", { cache: "no-store", signal });
}

/** 重名（区分大小写的完全相同）时后端返回 400，detail 为 "A team with that name already exists"。 */
export function createTeam(input: TeamInput): Promise<CreateTeamResult> {
  return apiFetch<CreateTeamResult>("/api/teams", {
    method: "POST",
    body: input,
  });
}

export function updateTeam(id: number, input: TeamInput): Promise<void> {
  return apiFetch<void>(`/api/teams/${id}`, { method: "PUT", body: input });
}

/** 成员关系随之级联删除；团队留言板的消息保留，但 team_id 被清空。 */
export function deleteTeam(id: number): Promise<void> {
  return apiFetch<void>(`/api/teams/${id}`, { method: "DELETE" });
}
