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

/**
 * 后端列表行带 account_type 才算支持账号类型（Annie 2026-10-26「账号类型按建议，动手」）。
 * 没带（后端还没上线）时页面和以前一模一样：不出类型选项、请求也不带 account_type。
 */
export function supportsAccountType(
  members: readonly TeamMemberUser[],
): boolean {
  return members.some((m) => m.account_type !== undefined);
}

/** partner 的首页：固定是 /dashboard 上的 partner 首页（Annie 2026-10-27 Q1 A / Q7 A），Team 页不再给 partner 选。 */
export const PARTNER_HOME = "/dashboard";

/** partner 的橙色（标签、头像、说明框）：普通文字标签，不是按钮，不用蓝色（蓝色只给提交键）。 */
export const PARTNER_COLOR = "#9a3412";
export const PARTNER_TAG_CLASS =
  "border border-[#fdba74] bg-[#ffedd5] text-[#9a3412]";
export const PARTNER_NOTE_CLASS =
  "rounded-[8px] border border-[#fdba74] bg-[#fff7ed] px-3 py-2 text-[12.5px] leading-[1.55] text-[#7c2d12]";

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
  // 后端 G187（Annie 确认）：有 report.view 就能改自己登记的；report.edit = 改所有人的。别为了让员工「能编辑」去开它。
  "report.edit":
    "Edit report entries = edit everyone's report entries. Everyone can already edit the entries they logged themselves.",
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
