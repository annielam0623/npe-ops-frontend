import type {
  AdminUser,
  AssignableRole,
  CurrentUser,
  UserRole,
} from "@/types";

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
    badgeClass:
      "bg-[#f3e8ff] night:bg-violet-400/15 text-[#6d28d9] night:text-violet-300",
    textClass: "text-[#6d28d9] night:text-violet-300",
    avatarClass: "bg-[#6d28d9]",
  },
  admin: {
    label: "Admin",
    badgeClass:
      "bg-[#dcfce7] night:bg-emerald-400/10 text-[#166534] night:text-emerald-300",
    textClass: "text-[#166534] night:text-emerald-300",
    avatarClass: "bg-[#1a6b3c]",
  },
  // 旧页面后端 82 加的（2026-10-14）：徽章 #e0e7ff / #3730a3，头像 #4338ca。
  supervisor: {
    label: "Supervisor",
    badgeClass:
      "bg-[#e0e7ff] night:bg-indigo-400/15 text-[#3730a3] night:text-indigo-300",
    textClass: "text-[#3730a3] night:text-indigo-300",
    avatarClass: "bg-[#4338ca]",
  },
  staff: {
    label: "Staff",
    badgeClass:
      "bg-[#dbeafe] night:bg-sky-400/15 text-[#1e40af] night:text-sky-300",
    textClass: "text-[#1e40af] night:text-sky-300",
    avatarClass: "bg-[#3b82f6]",
  },
  driver: {
    label: "Driver",
    badgeClass:
      "bg-[#fef3c7] night:bg-amber-400/15 text-[#92400e] night:text-amber-200",
    textClass: "text-[#92400e] night:text-amber-200",
    avatarClass: "bg-[#b45309]",
  },
  guide: {
    label: "Guide",
    badgeClass:
      "bg-[#ccfbf1] night:bg-teal-400/15 text-[#115e59] night:text-teal-300",
    textClass: "text-[#115e59] night:text-teal-300",
    avatarClass: "bg-[#0f766e]",
  },
};

/**
 * 下拉框里可选的角色，顺序与旧页面一致。
 * ⛔ 必须和后端 ASSIGNABLE_ROLES 一致：多写一个后端会 400，少写一个界面上就改不回来。
 */
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  "admin",
  "supervisor",
  "staff",
  "driver",
  "guide",
];

/** 后端认不认 supervisor：`/api/me` 带了 `is_supervisor` 字段就是已上线（后端没上线时不给选、不写说明）。 */
export function supportsSupervisor(me: CurrentUser): boolean {
  return typeof me.is_supervisor === "boolean";
}

/** 下拉框给的角色：后端还不认 supervisor 时拿掉它，免得选了 400。 */
export function assignableRolesFor(
  withSupervisor: boolean,
): readonly AssignableRole[] {
  return withSupervisor
    ? ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES.filter((role) => role !== "supervisor");
}

/** 外勤身份：改成它们会当场收走这个人的全部后台权限。 */
export const FIELD_ROLES: readonly UserRole[] = ["driver", "guide"];

export const DISPLAY_NAME_MAX_LENGTH = 100;

/** 库里的 role 是自由字符串；不认识的按 staff 显示（后端也只把 admin / superadmin 当管理员，supervisor 不算）。 */
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
