import { apiFetch } from "@/lib/api-client";
import type {
  AdminUser,
  AssignableRole,
  InviteResult,
  ResetLinkResult,
} from "@/types";

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
 * 注册页在后端（Jinja2），经 ops 的转发打开：链接用 ops 自己的网址，新员工注册完就在 ops 登录（分批切换，Annie 2026-10-10）。
 * 不用后端返回的 invite_url：它按请求到达后端的地址拼，经过代理时主机名是代理目标。
 */
export function buildInviteUrl(token: string): string {
  return `${window.location.origin}/register/${encodeURIComponent(token)}`;
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

/**
 * 给一个账号生成一次性密码重置链接（只有 admin；24 小时有效，只返回这一次）。
 * 400 原话：Cannot generate a reset link for your own account / Cannot reset a superadmin account's password /
 * Cannot generate a reset link for an inactive account；找不到用户 404 "User not found"。
 */
export function createResetLink(id: number): Promise<ResetLinkResult> {
  return apiFetch<ResetLinkResult>(`/api/users/${id}/reset-link`, {
    method: "POST",
    cache: "no-store",
  });
}

/** 重置页在后端（Jinja2），经 ops 转发打开，同 buildInviteUrl：链接用 ops 自己的网址，不用后端返回的 reset_url。 */
export function buildResetUrl(token: string): string {
  return `${window.location.origin}/reset-password/${encodeURIComponent(token)}`;
}
