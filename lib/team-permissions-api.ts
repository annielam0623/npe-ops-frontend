import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/types";
import type {
  AccountType,
  NewTeamAccount,
  NewTeamInvite,
  TeamCatalog,
  TeamInviteResult,
  TeamMember,
  TeamMemberDetail,
  TeamContactInput,
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

/**
 * 切换已有账号的类型（后端 8a）。值没变也是 200；superadmin 403、driver / guide / 不存在 404、坏值 400。
 * 两个方向都不动勾选；partner → staff 一律变成 role=staff（原来的 admin / supervisor 不恢复）。
 */
export function changeTeamAccountType(
  id: number,
  accountType: AccountType,
): Promise<{ ok: true; member: TeamMemberDetail }> {
  return apiFetch<{ ok: true; member: TeamMemberDetail }>(
    `/api/team/members/${id}/account-type`,
    { method: "PUT", cache: "no-store", body: { account_type: accountType } },
  );
}

/**
 * 改 Email / Mobile（staff 联络方式，Annie 2026-10-29「4项全部动手」，preview https://claude.ai/artifact/83D67jt2oNb5V1TPkteEt9）。
 * 只有 Super Admin；格式不对 / email 和别的账号重了回 400，detail 是 `{field: "email" | "phone", message}`（见 {@link contactFieldError}）。
 */
export function saveTeamContact(
  id: number,
  contact: TeamContactInput,
): Promise<void> {
  return apiFetch<void>(`/api/team/members/${id}/contact`, {
    method: "PUT",
    body: contact,
  });
}

/**
 * detail 是 `{field, message}` 时，取出是哪一格出错（写在那一格下面）。后端 G219 格式错 / email 重了回 400，
 * 账号已经不在了回 404，两种都是这个形状。
 */
export function contactFieldError(
  error: unknown,
): { field: "email" | "phone"; message: string } | null {
  if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 404)) return null;
  const d = (error.body as { detail?: unknown } | null)?.detail;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const o = d as { field?: unknown; message?: unknown };
    if (
      (o.field === "email" || o.field === "phone") &&
      typeof o.message === "string"
    ) {
      return { field: o.field, message: o.message };
    }
  }
  return null;
}
