import type { AdminUser, AssignableRole, UserRole } from "@/types";

interface RoleStyle {
  label: string;
  /** 角色徽章：浅底深字。 */
  badgeClass: string;
  /** 徽章的字色，单独给下拉框用。 */
  textClass: string;
  /** 头像底色。 */
  avatarClass: string;
}

/**
 * 与旧页面 settings_users.html 的配色一致：管理绿 / 司机琥珀 / 导游青 / staff 蓝 / 超管紫。
 * 外勤两个角色一眼能认出来很重要——他们看不到任何后台数据，排查「他怎么进不去」时先看这里。
 */
export const ROLE_STYLES: Record<UserRole, RoleStyle> = {
  superadmin: {
    label: "Super Admin",
    badgeClass: "bg-[#f3e8ff] text-[#6d28d9]",
    textClass: "text-[#6d28d9]",
    avatarClass: "bg-[#6d28d9]",
  },
  admin: {
    label: "Admin",
    badgeClass: "bg-[#dcfce7] text-[#166534]",
    textClass: "text-[#166534]",
    avatarClass: "bg-[#1a6b3c]",
  },
  staff: {
    label: "Staff",
    badgeClass: "bg-[#dbeafe] text-[#1e40af]",
    textClass: "text-[#1e40af]",
    avatarClass: "bg-[#3b82f6]",
  },
  driver: {
    label: "Driver",
    badgeClass: "bg-[#fef3c7] text-[#92400e]",
    textClass: "text-[#92400e]",
    avatarClass: "bg-[#b45309]",
  },
  guide: {
    label: "Guide",
    badgeClass: "bg-[#ccfbf1] text-[#115e59]",
    textClass: "text-[#115e59]",
    avatarClass: "bg-[#0f766e]",
  },
};

/**
 * 下拉框里可选的角色，顺序与旧页面一致。
 * ⛔ 必须和后端 ASSIGNABLE_ROLES 一致：多写一个后端会 400，少写一个界面上就改不回来。
 */
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  "admin",
  "staff",
  "driver",
  "guide",
];

/** 外勤身份：改成它们会当场收走这个人的全部后台权限。 */
export const FIELD_ROLES: readonly UserRole[] = ["driver", "guide"];

export const DISPLAY_NAME_MAX_LENGTH = 100;

/** 库里的 role 是自由字符串；不认识的按 staff 显示（后端也只把 admin / superadmin 当管理员）。 */
export function normalizeRole(role: string): UserRole {
  return role in ROLE_STYLES ? (role as UserRole) : "staff";
}

export function isAssignableRole(role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/** 邀请还没人注册：占位账号，没有真实用户名。 */
export function isPending(user: AdminUser): boolean {
  return !user.invite_used;
}

export function displayNameOf(user: AdminUser): string {
  return user.display_name?.trim() || user.username;
}

export function avatarTextOf(user: AdminUser): string {
  if (isPending(user)) {
    return "?";
  }
  return user.initials?.trim() || user.username.charAt(0).toUpperCase() || "?";
}

// 后台在洛杉矶，日期按洛杉矶时区显示（created_at 是 UTC）。
const JOINED_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  year: "numeric",
  timeZone: "America/Los_Angeles",
});

/** 与旧页面格式一致，例如 "Sep 27, 2026"；待注册或没有时间时返回 "—"。 */
export function formatJoinedDate(user: AdminUser): string {
  if (isPending(user) || !user.created_at) {
    return "—";
  }
  const date = new Date(user.created_at);
  return Number.isNaN(date.getTime()) ? "—" : JOINED_DATE_FORMAT.format(date);
}

/** 改角色确认框的文案；改成外勤角色时写明后果（与旧页面一致）。 */
export function describeRoleChange(
  user: AdminUser,
  role: AssignableRole,
): { message: string; warning: string | null } {
  const label = ROLE_STYLES[role].label;
  const message = `Change ${displayNameOf(user)}'s role to ${label}?`;
  if (!FIELD_ROLES.includes(role)) {
    return { message, warning: null };
  }
  return {
    message,
    warning:
      "They will LOSE access to the entire back office — orders, guests, reports and settings. " +
      "They will only see their own field page. You can change them back to Staff here at any time.",
  };
}
