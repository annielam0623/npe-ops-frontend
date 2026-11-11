import { apiFetch } from "@/lib/api-client";

/**
 * Today's team 的在线同事 + 站内消息（Annie 2026-10-30「两件都动手」，preview https://claude.ai/artifact/MyYTZjQzmJLaWckQjPxVGd ）。
 * 形状以后端 21 的实现为准（2026-10-31 发来，等 v138 上 main）：
 * - `GET /api/team/online` → `{online_minutes: 30, people: TeamPerson[]}`：只列 30 分钟内在 ops 上有操作的 Team 员工账号
 *   （Annie「Q1 30分钟」「在线员工包括teams里的人」；不含合作方、司机、导游、停用的和自己），所以 online 恒为 true；
 *   开关 team_messages_direct 没对我开 ⇒ 403。
 * - `POST /api/team/messages {to_user_id, body}` → `{ok, id, emailed}`：写一条对方的 Notice（kind `message`），同时发邮件到对方
 *   Team 里登记的 Email（没有 Email 只写站内，`emailed: false`）；body 1–2000 字，400 / 404 的 detail 是英文原话。
 * - `POST /api/team/messages/{id}/reply {body}` → `{ok, id}`：站内回复，只写 Notice，不发邮件（Annie「Q4 A 站内回复，不用邮件」）；
 *   不挂开关（收到消息的人都能回）。回复也是 kind `message`（「X replied to your message」），对方能接着回。
 * - `/api/notices` 消息类每条带 `ref: {kind: "message", message_id, from_user_id, from_display_name}`。
 */
export interface TeamPerson {
  id: number;
  display_name: string | null;
  username: string;
  role?: string;
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

/**
 * POST /api/team/messages 的返回。置顶 109 W4 第二段（后端 f30d895a，send-outcome 文档第 5 节）加了 sent / failed / no_contact
 * （站内 Notice 和消息同一个事务，人人都是 sent）和 email 人数：failed = 发信出错，no_email = 没有 Team Email
 * （原来 emailed: false 分不出这两种）。没带 = 旧后端。
 */
export interface TeamMessageResult {
  ok: boolean;
  id?: number;
  emailed?: boolean;
  sent?: string[];
  failed?: { name: string; error: string }[];
  no_contact?: { name: string; why: string }[];
  email?: { sent: number; failed: number; no_email: number };
}

/** 邮件这一路的结果：emailed 发出；failed 发信出错（红）；no_email 没邮箱（灰，不算失败）；unknown 旧后端没发出、分不清。 */
export type TeamMessageEmail = "emailed" | "failed" | "no_email" | "unknown";

export function messageEmailOutcome(r: TeamMessageResult): TeamMessageEmail {
  if (r.email) {
    if (r.email.sent > 0) return "emailed";
    if (r.email.failed > 0) return "failed";
    if (r.email.no_email > 0) return "no_email";
  }
  return r.emailed ? "emailed" : "unknown";
}

export function sendTeamMessage(
  toUserId: number,
  body: string,
): Promise<TeamMessageResult> {
  return apiFetch("/api/team/messages", {
    method: "POST",
    body: { to_user_id: toUserId, body },
  });
}

export function replyTeamMessage(
  messageId: number,
  body: string,
): Promise<{ ok: boolean; id?: number }> {
  return apiFetch(`/api/team/messages/${messageId}/reply`, {
    method: "POST",
    body: { body },
  });
}

export function personName(p: TeamPerson): string {
  return p.display_name?.trim() || p.username;
}
