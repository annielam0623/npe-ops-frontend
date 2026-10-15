import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

import { ROLE_STYLES } from "./config";

function RoleTag({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        "rounded-[12px] px-2 py-0.5 font-semibold whitespace-nowrap",
        ROLE_STYLES[role].badgeClass,
      )}
    >
      {ROLE_STYLES[role].label}
    </span>
  );
}

/**
 * 与旧页面 settings_users.html 底部的角色说明一致（文字、间距、配色）。
 * Supervisor（Annie 2026-10-14 新加）照旧页面的那句；后端认它以后才写进来。
 */
export function RoleLegend({ withSupervisor }: { withSupervisor: boolean }) {
  return (
    <section className="mt-5 rounded-[8px] border border-[#e5e7eb] bg-paper px-[18px] py-3.5 text-[12px] leading-[1.6] text-[#1a1a1a] night:border-white/10 night:bg-white/[.03] night:text-white/55">
      <p>
        <strong className="text-[#1a1a1a] night:text-white/75">
          Role permissions:
        </strong>
        &nbsp; <RoleTag role="superadmin" /> — Full access + can change user
        roles. &nbsp;&nbsp; <RoleTag role="admin" /> — Full access including
        Settings &amp; User management. &nbsp;&nbsp;{" "}
        {withSupervisor ? (
          <>
            <RoleTag role="supervisor" /> — Same as Staff today (no Settings or
            Users). Will also run the new team dashboard: tasks, schedule,
            handovers and daily reports. &nbsp;&nbsp;{" "}
          </>
        ) : null}
        <RoleTag role="staff" /> — Send notifications, view logs &amp;
        manifests, all ops inputs &amp; exports. Cannot access Settings or
        Users.
      </p>
      <p className="mt-2.5 border-t border-[#e5e7eb] pt-2.5 night:border-white/10">
        <strong className="text-[#92400e] night:text-amber-200">
          Field roles — no back office at all:
        </strong>
        &nbsp; <RoleTag role="driver" /> — Sees only his own pickup list for
        today. No orders, guests, reports or settings. &nbsp;&nbsp;{" "}
        <RoleTag role="guide" /> — Placeholder page for now. Same: no back
        office.
      </p>
    </section>
  );
}
