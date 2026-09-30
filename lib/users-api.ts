import { apiFetch } from "@/lib/api-client";
import { env } from "@/lib/env";
import type { AdminUser, AssignableRole, InviteResult } from "@/types";

// 除改角色外都要 admin；出错一律 {"detail": "<原因>"}，页面直接显示（见 lib/api-errors.ts）。

/** 响应里有待注册邀请的 invite_token，后端已加 no-store，这里也不缓存。 */
export function fetchUsers(signal?: AbortSignal): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/api/users", { cache: "no-store", signal });
}

/** 建一个待注册的占位账号（role=staff、未激活），返回一次性注册链接。 */
export function createInvite(): Promise<InviteResult> {
  return apiFetch<InviteResult>("/api/users/invite", {
    method: "POST",
    cache: "no-store",
  });
}

/**
 * 注册页仍在旧后台（Jinja2），链接指向旧后台域名。
 * 不用后端返回的 invite_url：它按请求到达后端的地址拼，经过 /api 代理时主机名是代理目标。
 */
export function buildInviteUrl(token: string): string {
  return `${env.legacyAdminBaseUrl}/register/${encodeURIComponent(token)}`;
}

/** 整体替换该用户所属的团队。 */
export function updateUserTeams(id: number, teamIds: number[]): Promise<void> {
  return apiFetch<void>(`/api/users/${id}/teams`, {
    method: "PUT",
    body: { team_ids: teamIds },
  });
}

/** 后端会 trim；空字符串返回 400 "Display name cannot be empty"。 */
export function updateDisplayName(
  id: number,
  displayName: string,
): Promise<void> {
  return apiFetch<void>(`/api/users/${id}/display-name`, {
    method: "PUT",
    body: { display_name: displayName },
  });
}

/** 不能停用自己，也不能停用 superadmin（400）。 */
export function deactivateUser(id: number): Promise<void> {
  return apiFetch<void>(`/api/users/${id}/deactivate`, { method: "POST" });
}

/** 不能恢复 superadmin（400）。 */
export function reactivateUser(id: number): Promise<void> {
  return apiFetch<void>(`/api/users/${id}/reactivate`, { method: "POST" });
}

/** 永久删除账号或待注册邀请；不能删自己，也不能删 superadmin（400）。 */
export function deleteUser(id: number): Promise<void> {
  return apiFetch<void>(`/api/users/${id}`, { method: "DELETE" });
}

/** 只有 superadmin 能调（否则 403）；不能改自己、不能改 superadmin（400）。 */
export function changeUserRole(
  id: number,
  role: AssignableRole,
): Promise<void> {
  return apiFetch<void>(`/api/users/${id}/role`, {
    method: "POST",
    body: { role },
  });
}
