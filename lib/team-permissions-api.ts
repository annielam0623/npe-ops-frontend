import { apiFetch } from "@/lib/api-client";
import type {
  NewTeamAccount,
  NewTeamInvite,
  TeamCatalog,
  TeamInviteResult,
  TeamMember,
  TeamMemberDetail,
  TeamSelection,
} from "@/types";

// Team 页（Team 权限 v2）：全部只有 superadmin 能调，Admin 也 403。后端都回 no-store，这里也不缓存。
// 出错一律 {"detail": "<原因>"}，页面直接显示。

export function fetchTeamCatalog(signal?: AbortSignal): Promise<TeamCatalog> {
  return apiFetch<TeamCatalog>("/api/team/catalog", {
    cache: "no-store",
    signal,
  });
}

/** 后台账号（不含司机、导游）+ 部门邮箱那一行。 */
export function fetchTeamMembers(signal?: AbortSignal): Promise<TeamMember[]> {
  return apiFetch<TeamMember[]>("/api/team/members", {
    cache: "no-store",
    signal,
  });
}

/** 编辑和「照某个人复制」都用它；复制只填表单，按保存才生效。 */
export function fetchTeamMember(
  id: number,
  signal?: AbortSignal,
): Promise<TeamMemberDetail> {
  return apiFetch<TeamMemberDetail>(`/api/team/members/${id}`, {
    cache: "no-store",
    signal,
  });
}

/** 整组替换；superadmin 账号 403，未知的项 400（什么都不存）。 */
export function saveTeamMember(
  id: number,
  selection: TeamSelection,
): Promise<void> {
  return apiFetch<void>(`/api/team/members/${id}`, {
    method: "PUT",
    body: selection,
  });
}

/** 部门邮箱只有职责可以改。 */
export function saveContactDuties(id: number, duties: string[]): Promise<void> {
  return apiFetch<void>(`/api/team/contacts/${id}/duties`, {
    method: "PUT",
    body: { duties },
  });
}

/** Super Admin 直接建号：首次登录必须改密码；勾选按请求存（不套默认组）。 */
export function createTeamAccount(account: NewTeamAccount): Promise<void> {
  return apiFetch<void>("/api/team/members", {
    method: "POST",
    body: account,
  });
}

/** 生成邀请链接并存好勾选；链接用 users-api 的 buildInviteUrl 按 ops 自己的网址拼。 */
export function createTeamInvite(
  selection: NewTeamInvite,
): Promise<TeamInviteResult> {
  return apiFetch<TeamInviteResult>("/api/team/invites", {
    method: "POST",
    cache: "no-store",
    body: selection,
  });
}
