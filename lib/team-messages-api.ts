import { apiFetch } from "@/lib/api-client";

/**
 * Today's team 的在线同事 + 站内消息（Annie 2026-10-30「两件都动手」，preview https://claude.ai/artifact/MyYTZjQzmJLaWckQjPxVGd ）。
 * ⚠️ 后端还没有（转 57 排），形状是前端提的，接口上了以后照真接口核一遍：
 * - `GET /api/team/online` → `{people: TeamPerson[]}`：Team 页的员工账号（staff / supervisor / admin / Super Admin，
 *   不含合作方、司机、导游和自己），`online` = 最近 30 分钟在 ops 上有操作（Annie「Q1 30分钟」「在线员工包括teams里的人」）；
 * - `POST /api/team/messages {to_user_id, body}` → `{ok, emailed}`：写一条对方的 Notice（type `message`），同时发邮件到对方
 *   Team 里登记的 Email（没有 Email 只写站内，`emailed: false`）；
 * - `POST /api/team/messages/{id}/reply {body}` → `{ok}`：站内回复，只写 Notice，不发邮件（Annie「Q4 A 站内回复，不用邮件」）。
 */
export interface TeamPerson {
  id: number;
  display_name: string | null;
  username: string;
  online: boolean;
  last_seen_at: string | null;
  /** Team 里登记了 Email（发消息时同时发邮件）。 */
  has_email: boolean;
}

/** 消息最长几个字（后端同样挡）。 */
export const MESSAGE_MAX = 2000;

export async function fetchTeamPeople(
  signal?: AbortSignal,
): Promise<TeamPerson[]> {
  const r = await apiFetch<{ people?: TeamPerson[] }>("/api/team/online", {
    cache: "no-store",
    signal,
  });
  return r.people ?? [];
}

export function sendTeamMessage(
  toUserId: number,
  body: string,
): Promise<{ ok: boolean; emailed?: boolean }> {
  return apiFetch("/api/team/messages", {
    method: "POST",
    body: { to_user_id: toUserId, body },
  });
}

export function replyTeamMessage(
  messageId: number,
  body: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/team/messages/${messageId}/reply`, {
    method: "POST",
    body: { body },
  });
}

export function personName(p: TeamPerson): string {
  return p.display_name?.trim() || p.username;
}
