import type { TeamMemberUser } from "@/types";

/**
 * 默认首页的选项：侧栏里的主要页面（Annie 2026-10-25 看过 preview 后「动手」）。
 * 后端只校验是站内路径；"" = 没选，登录后进 Dashboard（PUT 时传 null）。
 */
export const HOME_PAGES: readonly { path: string; label: string }[] = [
  { path: "", label: "Dashboard (default)" },
  { path: "/manifests", label: "Manifests" },
  { path: "/dispatch", label: "Dispatch" },
  { path: "/forecast", label: "7 Days Forecast" },
  { path: "/orders", label: "Orders" },
  { path: "/morning-pickup/tracking", label: "Morning Pickup · Tracking" },
  {
    path: "/tour-confirmation/tracking",
    label: "Tour Confirmation · Tracking",
  },
  { path: "/tickets-reminder/tracking", label: "Ticket Reminder · Tracking" },
  { path: "/schedule", label: "Work Schedule" },
  { path: "/daily-report", label: "Daily Operation Report" },
  { path: "/workspace", label: "My Workspace" },
  { path: "/sales-report", label: "Sales Report" },
];

/** 列表上的首页名；不在清单里的路径原样显示。 */
export function homeLabel(path: string | null | undefined): string {
  if (!path) {
    return "Dashboard";
  }
  return HOME_PAGES.find((p) => p.path === path)?.label ?? path;
}

/** 后端说明：只取消 reports.export 时旧页面仍能导出（导出在浏览器里做），在这一项下面写明。 */
export const ITEM_NOTES: Readonly<Record<string, string>> = {
  "reports.export":
    "The old pages can still export until export moves to the server.",
};

export function memberName(
  member: Pick<TeamMemberUser, "display_name" | "username" | "pending_invite">,
): string {
  if (member.pending_invite) {
    return "Pending registration…";
  }
  return member.display_name?.trim() || member.username;
}

/** 头像字：待注册是 ?，其余取名字的首字母（最多两个）。 */
export function avatarText(member: TeamMemberUser): string {
  if (member.pending_invite) {
    return "?";
  }
  const words = memberName(member).split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w.charAt(0))
      .join("")
      .toUpperCase() || "?"
  );
}
